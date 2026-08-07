import {
  createGraphEdge,
  createGraphNode,
  createImpactAnalysis,
  createImplementationReview,
  createKnowledgeGraph,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildReviewDrift, driftOmittedTotal } from './review-drift.js';

import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  RequirementImpact,
} from '@impactgraph/domain';

// Item 7: the drift builder wires the classifier to the workspace's boundary sources — the
// configured contexts (read-time overlay) and the roster prefixes. Where neither exists the
// boundary categories are absent, never guessed.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-06T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path: string, type = 'file'): GraphNode => {
  const result = createGraphNode({ id, category: 'repository', type, name, path, knowledge });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type: 'IMPORTS', sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const graph = (nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const impact = (nodeId: string): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId,
  likelihood: 'required',
  impactType: 'business-rule',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: `predicted change to ${nodeId}`,
  expectedChanges: ['update logic'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis',
});

const analysisOf = (impacts: RequirementImpact[]): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-06T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });
  if (!result.ok) {
    throw new Error('analysis invalid');
  }
  return result.value;
};

const reviewOf = (
  changedFiles: string[],
  edgeChanges: ImplementationReview['edgeChanges'],
): ImplementationReview => {
  const result = createImplementationReview({
    id: 'review-1',
    analysisId: 'analysis-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    createdAt: '2026-08-06T12:00:00.000Z',
    changedFiles,
    findings: [],
    coverage: [],
    edgeChanges,
  });
  if (!result.ok) {
    throw new Error('review invalid');
  }
  return result.value;
};

const deals = node('file:src/deals/service.ts', 'service.ts', 'src/deals/service.ts');
const billing = node('file:src/billing/api.ts', 'api.ts', 'src/billing/api.ts');
const docs = node('file:api-docs/openapi.yml', 'openapi.yml', 'api-docs/openapi.yml');

const ARCHITECTURE: ArchitectureConfigDto = {
  schemaVersion: 1,
  contexts: [
    { name: 'deals', paths: ['src/deals/**'] },
    { name: 'billing', paths: ['src/billing/**'] },
  ],
};

describe('buildReviewDrift', () => {
  it('classifies a new cross-context edge when contexts are configured', () => {
    const dependency = edge('e-1', billing.id, deals.id);
    const drift = buildReviewDrift({
      review: reviewOf(['src/billing/api.ts'], { added: ['e-1'], removed: [] }),
      analysis: analysisOf([impact(deals.id)]),
      approvedGraph: graph([deals, billing], []),
      currentGraph: graph([deals, billing], [dependency]),
      architecture: ARCHITECTURE,
    });
    expect(drift.entries).toEqual([
      {
        edgeId: 'e-1',
        edgeType: 'IMPORTS',
        direction: 'added',
        category: 'cross-context',
        from: { nodeId: billing.id, nodeName: 'api.ts', context: 'billing' },
        to: { nodeId: deals.id, nodeName: 'service.ts', context: 'deals' },
      },
    ]);
    // The diff touched billing, and the approved analysis predicted only deals.
    expect(drift.unmappedContexts).toEqual({ contexts: ['billing'] });
  });

  it('omits boundary categories entirely when neither contexts nor a roster exist', () => {
    const dependency = edge('e-1', billing.id, deals.id);
    const drift = buildReviewDrift({
      review: reviewOf(['src/billing/api.ts'], { added: ['e-1'], removed: [] }),
      analysis: analysisOf([impact(deals.id)]),
      approvedGraph: graph([deals, billing], []),
      currentGraph: graph([deals, billing], [dependency]),
    });
    expect(drift.entries[0]?.category).toBe('new-dependency');
    expect(drift.entries[0]?.from.context).toBeUndefined();
    expect(drift.entries[0]?.from.repository).toBeUndefined();
    expect(drift.unmappedContexts).toBeUndefined();
  });

  it('attributes endpoints to registered repositories under a multi-root roster', () => {
    const dependency = edge('e-1', deals.id, docs.id);
    const drift = buildReviewDrift({
      review: reviewOf(['src/deals/service.ts'], { added: ['e-1'], removed: [] }),
      analysis: analysisOf([impact(deals.id)]),
      approvedGraph: graph([deals, docs], []),
      currentGraph: graph([deals, docs], [dependency]),
      rosterRepositories: [{ name: '(workspace root)' }, { name: 'api-docs', path: 'api-docs' }],
    });
    expect(drift.entries[0]?.category).toBe('cross-repository');
    expect(drift.entries[0]?.from.repository).toBe('(workspace root)');
    expect(drift.entries[0]?.to.repository).toBe('api-docs');
  });

  it('totals the omitted drift entries for the scope limitations', () => {
    expect(
      driftOmittedTotal({
        entries: [],
        omitted: [
          { category: 'other', count: 3 },
          { category: 'new-dependency', count: 2 },
        ],
        unmappedContexts: { contexts: [], omitted: 1 },
      }),
    ).toBe(6);
    expect(driftOmittedTotal({ entries: [], omitted: [] })).toBe(0);
  });
});
