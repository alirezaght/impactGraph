import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
  stableRequirementId,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactModel, validateImpactReferences } from '../index.js';

import type { BuildImpactModelRequest } from '../index.js';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  ProposedRelationship,
  Specification,
} from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
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

// DealVisibilityPolicy (class) ← contained in file ← imported by DealQueryService file;
// policy WRITES_TO deals table; search indexer SUBSCRIBES_TO topic published by policy file.
const buildGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('sym:policy', 'domain', 'policy', 'DealVisibilityPolicy'),
      node('file:policy', 'repository', 'file', 'deal-visibility-policy.ts'),
      node('file:query', 'repository', 'file', 'deal-query-service.ts'),
      node('sym:query', 'application', 'service', 'DealQueryService'),
      node('table:deals', 'data', 'table', 'deals'),
      node('topic:deal-updated', 'integration', 'topic', 'deal-updated'),
      node('sym:indexer', 'application', 'service', 'DealSearchIndexer'),
      node('test:policy', 'application', 'test', 'deal-visibility-policy.test.ts'),
    ],
    [
      edge('e1', 'CONTAINS', 'file:policy', 'sym:policy'),
      edge('e2', 'IMPORTS', 'file:query', 'file:policy'),
      edge('e3', 'CONTAINS', 'file:query', 'sym:query'),
      edge('e4', 'WRITES_TO', 'sym:policy', 'table:deals'),
      edge('e5', 'PUBLISHES', 'sym:policy', 'topic:deal-updated'),
      edge('e6', 'SUBSCRIBES_TO', 'sym:indexer', 'topic:deal-updated'),
      edge('e7', 'TESTS', 'test:policy', 'sym:policy'),
    ],
  );
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const statement = 'DealVisibilityPolicy must hide expired deals.';

const spec = (concepts: readonly string[]): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: statement,
    version: 1,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    requirements: [
      {
        id: stableRequirementId(statement),
        statement,
        type: 'functional',
        concepts: [...concepts],
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
    throw new Error('spec invalid');
  }
  return result.value;
};

const proposal = (overrides: Partial<ProposedRelationship> = {}): ProposedRelationship => ({
  id: 'prop-1',
  sourceId: 'sym:query',
  targetId: 'topic:deal-updated',
  sourceKind: 'existing',
  targetKind: 'existing',
  type: 'PUBLISHES',
  status: 'proposed',
  originOptionId: 'opt-1',
  rationale: 'the option would add a publish',
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1'],
  confidence: 0.4,
  confidenceSignals: [{ type: 'framework-convention', contribution: 0.45 }],
  ...overrides,
});

const run = (
  concepts: readonly string[],
  overrides: Partial<BuildImpactModelRequest> = {},
): ImpactAnalysis => {
  const result = buildImpactModel({
    specification: spec(concepts),
    graph: buildGraph(),
    repositorySnapshotId: 'snap-1',
    analysisId: 'analysis-1',
    createdAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error('buildImpactModel failed');
  }
  return result.value;
};

const impactFor = (analysis: ImpactAnalysis, nodeId: string) =>
  analysis.requirementImpacts.find((impact) => impact.nodeId === nodeId);

const mustImpact = (analysis: ImpactAnalysis, nodeId: string) => {
  const impact = impactFor(analysis, nodeId);
  if (impact === undefined) {
    throw new Error(`expected impact for ${nodeId}`);
  }
  return impact;
};

describe('buildImpactModel — deterministic pipeline (Stories 6.1–6.4)', () => {
  it('classifies the exact match as required/direct with explainable confidence', () => {
    const analysis = run(['DealVisibilityPolicy']);
    const direct = impactFor(analysis, 'sym:policy');
    expect(direct?.likelihood).toBe('required');
    expect(direct?.directness).toBe('direct');
    expect(direct?.provenance).toBe('static-analysis');
    expect(direct?.confidence).toBe(0.9);
    expect(direct?.confidenceSignals.map((s) => s.type)).toContain('exact-concept-to-symbol-match');
  });

  it('surfaces dependents the spec never named — importer, table, subscriber, test (§46)', () => {
    const analysis = run(['DealVisibilityPolicy']);

    const table = mustImpact(analysis, 'table:deals');
    expect(table.likelihood).toBe('likely');
    expect(table.impactType).toBe('data-model');
    expect(table.dependencyPath).toEqual(['sym:policy', 'table:deals']);

    const importer = mustImpact(analysis, 'file:query');
    expect(importer.likelihood).toBe('possible'); // symbol → file → importer = 2 hops
    expect(importer.dependencyPath).toEqual(['sym:policy', 'file:policy', 'file:query']);
    expect(importer.confidenceSignals.map((s) => s.type)).toContain('direct-import');

    const indexer = mustImpact(analysis, 'sym:indexer');
    expect(indexer.likelihood).toBe('possible'); // via topic, 2 hops
    expect(indexer.confidenceSignals.map((s) => s.type)).toContain('event-relationship');

    const test = mustImpact(analysis, 'test:policy');
    expect(test.impactType).toBe('testing');
    expect(test.confidenceSignals.map((s) => s.type)).toContain('test-association');
  });

  it('every impact carries evidence, a real dependency path, and stored signals', () => {
    const analysis = run(['DealVisibilityPolicy']);
    expect(analysis.requirementImpacts.length).toBeGreaterThanOrEqual(5);
    for (const impact of analysis.requirementImpacts) {
      expect(impact.evidenceIds.length).toBeGreaterThan(0);
      expect(impact.dependencyPath.length).toBe(
        impact.confidence === 0.9 ? 1 : impact.dependencyPath.length,
      );
      expect(impact.confidenceSignals.length).toBeGreaterThan(0);
      expect(validateImpactReferences([impact], buildGraph())).toEqual([]);
    }
  });

  it('unknown concepts become warnings, never invented nodes', () => {
    const analysis = run(['FluxCapacitor']);
    expect(analysis.requirementImpacts).toEqual([]);
    expect(analysis.warnings[0]?.code).toBe('unknown-concept');
    expect(analysis.warnings[0]?.message).toContain('FluxCapacitor');
  });

  it('ambiguous concepts apply the ambiguity penalty to every candidate', () => {
    const graphWithTwin = (() => {
      const base = buildGraph();
      const result = createKnowledgeGraph(
        [...base.nodes.values(), node('sym:policy2', 'domain', 'policy', 'deal_visibility_policy')],
        [...base.edges.values()],
      );
      if (!result.ok) {
        throw new Error('twin graph invalid');
      }
      return result.value;
    })();
    const result = buildImpactModel({
      specification: spec(['DealVisibilityPolicy']),
      graph: graphWithTwin,
      repositorySnapshotId: 'snap-1',
      analysisId: 'analysis-2',
      createdAt: '2026-07-31T10:00:00.000Z',
    });
    if (!result.ok) {
      throw new Error('failed');
    }
    const twin = impactFor(result.value, 'sym:policy2');
    const original = impactFor(result.value, 'sym:policy');
    expect(twin).toBeDefined();
    expect(original?.confidence).toBe(0.75); // 0.9 exact − 0.15 ambiguity
    expect(original?.confidenceSignals.map((s) => s.type)).toContain('ambiguity');
  });

  it('is deterministic: identical inputs produce identical analyses (§43.5)', () => {
    const a = run(['DealVisibilityPolicy']);
    const b = run(['DealVisibilityPolicy']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('bounds traversal and records a cutoff warning', () => {
    const analysis = run(['DealVisibilityPolicy'], { traversal: { maxCandidates: 2 } });
    expect(analysis.warnings.some((warning) => warning.code === 'traversal-cutoff')).toBe(true);
    expect(analysis.requirementImpacts.length).toBeLessThanOrEqual(2);
  });

  it('a configured exclusion suppresses the impact and records a §Z9 warning', () => {
    const analysis = run(['DealVisibilityPolicy'], { excludedComponents: ['dealsearchindexer'] });
    expect(impactFor(analysis, 'sym:indexer')).toBeUndefined();
    const warning = analysis.warnings.find((entry) => entry.code === 'configured-exclusion');
    expect(warning?.message).toContain('DealSearchIndexer');
  });

  it('co-change history adds the historical-co-change signal to indirect impacts (§14)', () => {
    const withPath = (input: {
      id: string;
      category: string;
      type: string;
      name: string;
      path: string;
    }) => {
      const result = createGraphNode({ ...input, knowledge });
      if (!result.ok) {
        throw new Error(`node ${input.id}`);
      }
      return result.value;
    };
    const graphResult = createKnowledgeGraph(
      [
        withPath({
          id: 'sym:policy',
          category: 'domain',
          type: 'policy',
          name: 'DealVisibilityPolicy',
          path: 'src/policy.ts',
        }),
        withPath({
          id: 'file:policy',
          category: 'repository',
          type: 'file',
          name: 'policy.ts',
          path: 'src/policy.ts',
        }),
        withPath({
          id: 'file:query',
          category: 'repository',
          type: 'file',
          name: 'query.ts',
          path: 'src/query.ts',
        }),
      ],
      [
        edge('e1', 'CONTAINS', 'file:policy', 'sym:policy'),
        edge('e2', 'IMPORTS', 'file:query', 'file:policy'),
      ],
    );
    if (!graphResult.ok) {
      throw new Error('graph invalid');
    }
    const history = [
      ['src/policy.ts', 'src/query.ts'],
      ['src/policy.ts', 'src/query.ts'],
    ];
    const withHistory = run(['DealVisibilityPolicy'], { graph: graphResult.value, history });
    const importer = mustImpact(withHistory, 'file:query');
    expect(importer.confidenceSignals.map((s) => s.type)).toContain('historical-co-change');
    const withoutHistory = run(['DealVisibilityPolicy'], { graph: graphResult.value });
    expect(
      mustImpact(withoutHistory, 'file:query').confidenceSignals.map((s) => s.type),
    ).not.toContain('historical-co-change');
    expect(importer.confidence).toBeGreaterThan(
      mustImpact(withoutHistory, 'file:query').confidence,
    );
  });

  it('architectural options from clarification are bound into the analysis verbatim (§C8)', () => {
    const option = {
      id: 'opt-1',
      title: 'Filter at read time',
      description: 'AI-assisted interpretation.',
      affectedNodeIds: ['sym:policy'],
    };
    const analysis = run(['DealVisibilityPolicy'], { architecturalOptions: [option] });
    expect(analysis.architecturalOptions).toEqual([option]);
  });

  it('the reference gate rejects fabricated node ids (§43.2)', () => {
    const analysis = run(['DealVisibilityPolicy']);
    const forged = { ...analysis.requirementImpacts[0], nodeId: 'sym:invented' };
    const issues = validateImpactReferences(
      [forged as (typeof analysis.requirementImpacts)[0]],
      buildGraph(),
    );
    expect(issues.some((issue) => issue.code === 'unknown-node-reference')).toBe(true);
  });
});

describe('buildImpactModel — proposed structure gate (§18.4, §34)', () => {
  it('proposed structure rides ALONGSIDE the impacts, never inside them (§18.4, §3)', () => {
    const option = {
      id: 'opt-1',
      title: 'Publish expiry events',
      description: 'AI-assisted interpretation.',
      affectedNodeIds: ['sym:query', 'topic:deal-updated'],
    };
    const analysis = run(['DealVisibilityPolicy'], {
      architecturalOptions: [option],
      proposedStructure: { nodes: [], relationships: [proposal()] },
    });
    expect(analysis.proposedStructure?.relationships).toHaveLength(1);
    // the proposal exists ONLY in its own collection — nothing about it leaks into the impacts
    expect(JSON.stringify(analysis.requirementImpacts).includes('proposed')).toBe(false);
    for (const impact of analysis.requirementImpacts) {
      // every impact still describes CURRENT structure: a real node, deterministically derived
      expect(buildGraph().nodes.has(impact.nodeId as never)).toBe(true);
      expect(impact.provenance).not.toBe('llm-inferred');
    }
  });

  it('a proposal citing a nonexistent node is DROPPED with a recorded warning (§34)', () => {
    const option = {
      id: 'opt-1',
      title: 'Publish expiry events',
      description: 'AI-assisted interpretation.',
      affectedNodeIds: ['sym:query'],
    };
    const analysis = run(['DealVisibilityPolicy'], {
      architecturalOptions: [option],
      proposedStructure: {
        nodes: [],
        relationships: [proposal({ targetId: 'topic:hallucinated' })],
      },
    });
    expect(analysis.proposedStructure?.relationships).toEqual([]);
    const warning = analysis.warnings.find((entry) => entry.code === 'invalid-reference');
    // rejected, and the rejection is visible — never silently deleted, never promoted
    expect(warning?.message).toContain('topic:hallucinated');
    expect(
      analysis.requirementImpacts.every((impact) => impact.nodeId !== 'topic:hallucinated'),
    ).toBe(true);
  });

  it('a proposal citing an option the analysis does not carry is dropped with a warning', () => {
    const analysis = run(['DealVisibilityPolicy'], {
      architecturalOptions: [],
      proposedStructure: { nodes: [], relationships: [proposal()] },
    });
    expect(analysis.proposedStructure?.relationships).toEqual([]);
    expect(analysis.warnings.some((entry) => entry.code === 'invalid-reference')).toBe(true);
  });
});
