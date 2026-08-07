import { createGraphNode, createKnowledgeGraph, createSpecification } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildAnalyzeOutput } from './analyze-output.js';

import type { GraphNode, ImpactAnalysis, KnowledgeGraph, Specification } from '@impactgraph/domain';

// §18.4 — the analyze document carries the EFFECTIVE bounded context per impact, resolved
// through the §Z5 overlay, so a UI can group by context instead of guessing from path
// prefixes. A component with no assigned context has no `context` field: absent means
// unknown, and a consumer must render it as such rather than inventing one.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string): GraphNode => {
  const created = createGraphNode({
    id,
    name,
    category: 'application',
    type: 'service',
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture node ${id}`);
  }
  return created.value;
};

const graph = (): KnowledgeGraph => {
  const created = createKnowledgeGraph(
    [node('sym:deal', 'DealService'), node('sym:mail', 'Mailer')],
    [],
  );
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const statement = 'DealService must hide expired deals.';

const specification = (): Specification => {
  const created = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: statement,
    version: 1,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement,
        type: 'functional',
        concepts: ['DealService'],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!created.ok) {
    throw new Error('bad fixture spec');
  }
  return created.value;
};

const impact = (nodeId: string) => ({
  requirementId: 'req-1',
  nodeId,
  likelihood: 'required' as const,
  impactType: 'domain-model' as const,
  directness: 'direct' as const,
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match' as const, contribution: 0.9 }],
  explanation: 'matched',
  expectedChanges: ['review'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis' as const,
});

const analysis = (): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-02T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [impact('sym:deal'), impact('sym:mail')],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

const build = (contextByNodeId?: ReadonlyMap<string, string>) =>
  buildAnalyzeOutput({
    specification: specification(),
    analysis: analysis(),
    graph: graph(),
    evidenceFileById: new Map([['ev-1', 'src/deal-service.ts']]),
    extractionMode: 'deterministic-fallback',
    ...(contextByNodeId === undefined ? {} : { contextByNodeId }),
  });

describe('analyze document context projection (§18.4)', () => {
  it('carries the effective context for components that have one', () => {
    const output = build(new Map([['sym:deal', 'deal-management']]));
    const impacts = output.requirements[0]?.impacts ?? [];
    expect(impacts.find((entry) => entry.nodeId === 'sym:deal')?.context).toBe('deal-management');
  });

  it('omits the field entirely for a component with no assigned context — never invents one', () => {
    const output = build(new Map([['sym:deal', 'deal-management']]));
    const unassigned = output.requirements[0]?.impacts.find((entry) => entry.nodeId === 'sym:mail');
    expect(unassigned).toBeDefined();
    expect(unassigned?.context).toBeUndefined();
    expect(Object.hasOwn(unassigned ?? {}, 'context')).toBe(false);
  });

  it('is optional: a caller with no overlay data produces a document with no context anywhere', () => {
    const output = build();
    for (const entry of output.requirements[0]?.impacts ?? []) {
      expect(entry.context).toBeUndefined();
    }
  });
});

describe('analyze document evidence basis (ADR-0015, dogfooding item 4)', () => {
  it('carries the evidence-basis set and the tier cap through to each impact', () => {
    const output = buildAnalyzeOutput({
      specification: specification(),
      analysis: {
        ...analysis(),
        requirementImpacts: [
          {
            ...impact('sym:deal'),
            likelihood: 'likely',
            evidenceTypes: ['name-similarity', 'lexical-only'],
            tierCappedBy: 'name-similarity',
          },
        ],
      },
      graph: graph(),
      evidenceFileById: new Map(),
      extractionMode: 'deterministic-fallback',
    });
    const entry = output.requirements[0]?.impacts[0];
    expect(entry?.evidenceTypes).toEqual(['name-similarity', 'lexical-only']);
    expect(entry?.tierCappedBy).toBe('name-similarity');
  });

  it('reads an absent basis as lexical-only — the weakest reading, never "fine"', () => {
    const output = build();
    const entry = output.requirements[0]?.impacts[0];
    expect(entry?.evidenceTypes).toEqual(['lexical-only']);
    expect(entry?.tierCappedBy).toBeUndefined();
    expect(Object.hasOwn(entry ?? {}, 'tierCappedBy')).toBe(false);
  });
});

describe('analyze document requirement coverage (ADR-0015 semantics)', () => {
  const twoRequirementSpec = (): Specification => {
    const base = specification();
    return {
      ...base,
      requirements: [
        ...base.requirements,
        {
          id: 'req-2',
          statement: 'Expired deals disappear from search.',
          type: 'functional',
          concepts: ['search'],
          actors: [],
          status: 'draft',
        },
      ],
    };
  };

  const buildWith = (impacts: ImpactAnalysis['requirementImpacts']) =>
    buildAnalyzeOutput({
      specification: twoRequirementSpec(),
      analysis: { ...analysis(), requirementImpacts: impacts },
      graph: graph(),
      evidenceFileById: new Map(),
      extractionMode: 'deterministic-fallback',
    });

  it('a requirement whose ONLY finding is lexical-only is NOT covered', () => {
    const output = buildWith([
      impact('sym:deal'),
      {
        ...impact('sym:mail'),
        requirementId: 'req-2',
        likelihood: 'lexical-only',
        evidenceTypes: ['lexical-only'],
      },
    ]);
    expect(output.specification.readiness?.unmatchedRequirements).toBe(1);
  });

  it('a predictive, non-lexical impact still covers its requirement', () => {
    const output = buildWith([
      impact('sym:deal'),
      {
        ...impact('sym:mail'),
        requirementId: 'req-2',
        likelihood: 'possible',
        evidenceTypes: ['transitive-structural'],
      },
    ]);
    expect(output.specification.readiness?.unmatchedRequirements).toBe(0);
  });

  it('an excluded impact never counts as coverage', () => {
    const output = buildWith([
      impact('sym:deal'),
      { ...impact('sym:mail'), requirementId: 'req-2', likelihood: 'excluded' },
    ]);
    expect(output.specification.readiness?.unmatchedRequirements).toBe(1);
  });
});

const proposedRelationship = {
  id: 'proposed-rel-1',
  sourceId: 'sym:deal',
  targetId: 'sym:mail',
  sourceKind: 'existing' as const,
  targetKind: 'existing' as const,
  type: 'PUBLISHES' as const,
  status: 'proposed' as const,
  originOptionId: 'opt-1',
  rationale: 'the option would add a publish',
  provenance: 'llm-inferred' as const,
  evidenceIds: ['ev-1'],
  confidence: 0.4,
  confidenceSignals: [{ type: 'framework-convention' as const, contribution: 0.45 }],
};

const withProposals = (structure?: ImpactAnalysis['proposedStructure']) =>
  buildAnalyzeOutput({
    specification: specification(),
    analysis: {
      ...analysis(),
      architecturalOptions: [
        {
          id: 'opt-1',
          title: 'Publish expiry events',
          description: 'AI-assisted interpretation.',
          affectedNodeIds: ['sym:deal', 'sym:mail'],
        },
      ],
      ...(structure === undefined ? {} : { proposedStructure: structure }),
    },
    graph: graph(),
    evidenceFileById: new Map([['ev-1', 'src/deal.ts']]),
    extractionMode: 'provider',
  });

describe('analyze document proposed structure (§18.4)', () => {
  it('emits proposed relationships in their own field, never inside the impacts', () => {
    const output = withProposals({ nodes: [], relationships: [proposedRelationship] });
    expect(output.proposedStructure?.relationships).toHaveLength(1);
    expect(output.proposedStructure?.relationships[0]?.status).toBe('proposed');
    expect(output.proposedStructure?.relationships[0]?.originOptionId).toBe('opt-1');
    // the current half of the document is untouched by the proposal
    expect(JSON.stringify(output.requirements)).not.toContain('proposed');
  });

  it('carries the signals behind the score so the UI can explain it (§14)', () => {
    const output = withProposals({ nodes: [], relationships: [proposedRelationship] });
    expect(output.proposedStructure?.relationships[0]?.confidenceSignals).toEqual([
      { type: 'framework-convention', contribution: 0.45 },
    ]);
  });

  it('omits the field entirely when nothing was proposed — absence is not "unknown"', () => {
    expect(withProposals().proposedStructure).toBeUndefined();
    expect(withProposals({ nodes: [], relationships: [] }).proposedStructure).toBeUndefined();
  });
});
