import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
  err,
  ok,
  stableRequirementId,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactModel, refineWithClassifier } from '../index.js';

import type {
  ImpactClassification,
  ImpactClassificationPort,
  ModelProviderError,
} from '../index.js';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  Result,
  Specification,
} from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-01T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, category: string, type: string, name: string): GraphNode => {
  const result = createGraphNode({ id, category, type, name, knowledge });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const graph = ((): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('sym:policy', 'domain', 'policy', 'DealVisibilityPolicy'),
      node('table:deals', 'data', 'table', 'deals'),
    ],
    [edge('e1', 'WRITES_TO', 'sym:policy', 'table:deals')],
  );
  if (!result.ok) {
    throw new Error('graph');
  }
  return result.value;
})();

const statement = 'DealVisibilityPolicy must hide expired deals.';

const specification = ((): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: statement,
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: [
      {
        id: stableRequirementId(statement),
        statement,
        type: 'functional',
        concepts: ['DealVisibilityPolicy'],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('spec');
  }
  return result.value;
})();

const draftAnalysis = (): ImpactAnalysis => {
  const result = buildImpactModel({
    specification,
    graph,
    repositorySnapshotId: 'snap-1',
    analysisId: 'analysis-1',
    createdAt: '2026-08-01T10:00:00.000Z',
  });
  if (!result.ok) {
    throw new Error('analysis');
  }
  return result.value;
};

const mustFind = (analysis: ImpactAnalysis, nodeId: string) => {
  const impact = analysis.requirementImpacts.find((candidate) => candidate.nodeId === nodeId);
  if (impact === undefined) {
    throw new Error(`expected impact for ${nodeId}`);
  }
  return impact;
};

const stubClassifier = (
  result: Result<readonly ImpactClassification[], ModelProviderError>,
): ImpactClassificationPort => ({
  classify: () => Promise.resolve(result),
});

describe('refineWithClassifier (Story 6.3, §43.5 stage two)', () => {
  it('applies valid classifications as llm-inferred while keeping computed confidence', async () => {
    const analysis = draftAnalysis();
    const outcome = await refineWithClassifier(
      analysis,
      specification,
      graph,
      stubClassifier(
        ok([
          {
            nodeId: 'table:deals',
            likelihood: 'required',
            impactType: 'migration',
            explanation: 'Existing rows must be reclassified when the visibility rule changes.',
            expectedChanges: ['Add a migration marking expired deals invisible'],
          },
        ]),
      ),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.classificationMode).toBe('llm');
    const refined = mustFind(outcome.value.analysis, 'table:deals');
    const original = mustFind(analysis, 'table:deals');
    expect(refined.provenance).toBe('llm-inferred');
    expect(refined.likelihood).toBe('required');
    expect(refined.impactType).toBe('migration');
    expect(refined.explanation).toContain('reclassified');
    // Confidence and signals stay computed — never model-authored (§14).
    expect(refined.confidence).toBe(original.confidence);
    expect(refined.confidenceSignals).toEqual(original.confidenceSignals);
    // Unclassified candidates keep their deterministic form.
    expect(mustFind(outcome.value.analysis, 'sym:policy').provenance).toBe('static-analysis');
    // The input analysis is untouched (append-only history).
    expect(original.provenance).toBe('static-analysis');
  });

  it('rejects references outside the bounded candidate set with a warning (§43.2)', async () => {
    const outcome = await refineWithClassifier(
      draftAnalysis(),
      specification,
      graph,
      stubClassifier(
        ok([
          {
            nodeId: 'sym:invented-component',
            likelihood: 'required',
            impactType: 'domain-model',
            explanation: 'Hallucinated.',
            expectedChanges: [],
          },
        ]),
      ),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(
      outcome.value.analysis.warnings.some((warning) => warning.code === 'invalid-reference'),
    ).toBe(true);
    expect(
      outcome.value.analysis.requirementImpacts.every(
        (impact) => impact.provenance === 'static-analysis',
      ),
    ).toBe(true);
  });

  it('downgrades taxonomy-invalid classifications and keeps the deterministic result', async () => {
    const outcome = await refineWithClassifier(
      draftAnalysis(),
      specification,
      graph,
      stubClassifier(
        ok([
          {
            nodeId: 'table:deals',
            likelihood: 'certain',
            impactType: 'data-model',
            explanation: 'Bad likelihood.',
            expectedChanges: [],
          },
        ]),
      ),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(
      outcome.value.analysis.warnings.some((warning) => warning.code === 'unsupported-claim'),
    ).toBe(true);
    const kept = outcome.value.analysis.requirementImpacts.find(
      (impact) => impact.nodeId === 'table:deals',
    );
    expect(kept?.provenance).toBe('static-analysis');
  });

  it('clamps a model over-promotion to the evidence ceiling instead of voiding the batch', async () => {
    // A fuzzy anchor: the specification says 'VisibilityPolicy', the graph has
    // 'DealVisibilityPolicy' — a name-similarity match whose basis caps the tier at `likely`.
    const fuzzyStatement = 'The VisibilityPolicy must hide expired deals.';
    const fuzzySpecification = ((): Specification => {
      const result = createSpecification({
        ...specification,
        rawText: fuzzyStatement,
        requirements: [
          {
            id: stableRequirementId(fuzzyStatement),
            statement: fuzzyStatement,
            type: 'functional',
            concepts: ['VisibilityPolicy'],
            actors: [],
            status: 'draft',
          },
        ],
      });
      if (!result.ok) {
        throw new Error('fuzzy spec');
      }
      return result.value;
    })();
    const built = buildImpactModel({
      specification: fuzzySpecification,
      graph,
      repositorySnapshotId: 'snap-1',
      analysisId: 'analysis-2',
      createdAt: '2026-08-01T10:00:00.000Z',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const anchor = mustFind(built.value, 'sym:policy');
    expect(anchor.evidenceTypes).toEqual(['name-similarity']);
    expect(anchor.likelihood).toBe('likely');

    const outcome = await refineWithClassifier(
      built.value,
      fuzzySpecification,
      graph,
      stubClassifier(
        ok([
          {
            nodeId: 'sym:policy',
            likelihood: 'required', // over-promotion: the basis supports at most `likely`
            impactType: 'business-rule',
            explanation: 'The policy owns the visibility rule.',
            expectedChanges: ['Change the visibility predicate'],
          },
        ]),
      ),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // The refinement is NOT discarded: the record is stored at the capped tier as llm-inferred…
    const refined = mustFind(outcome.value.analysis, 'sym:policy');
    expect(outcome.value.classificationMode).toBe('llm');
    expect(refined.provenance).toBe('llm-inferred');
    expect(refined.likelihood).toBe('likely');
    expect(refined.tierCappedBy).toBe('name-similarity');
    expect(refined.impactType).toBe('business-rule');
    // …and the downgrade is recorded as an unsupported-claim warning (§34), never silent.
    expect(
      outcome.value.analysis.warnings.some(
        (warning) => warning.code === 'unsupported-claim' && warning.message.includes("'required'"),
      ),
    ).toBe(true);
  });

  it('provider failure leaves the deterministic analysis fully usable (PRD §8, §34)', async () => {
    const analysis = draftAnalysis();
    const failure: ModelProviderError = {
      name: 'ModelProviderError',
      code: 'provider-unavailable',
      message: 'endpoint down',
    };
    const outcome = await refineWithClassifier(
      analysis,
      specification,
      graph,
      stubClassifier(err(failure)),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.classificationMode).toBe('deterministic-only');
    expect(outcome.value.providerError?.code).toBe('provider-unavailable');
    expect(outcome.value.analysis).toBe(analysis);
  });
});
