import {
  createGraphEdge,
  createGraphNode,
  createImpactAnalysis,
  createKnowledgeGraph,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { classifyDrift, DRIFT_ENTRY_LIMIT } from './classify-drift.js';

import type { ClassifyDriftRequest } from './classify-drift.js';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementImpact,
} from '@impactgraph/domain';

// Item 7 (PRD §C15.3): the review's edge changes classified deterministically — boundary
// categories only where the boundary is KNOWN, bounded lists with counted omissions, and
// unmapped-context touches absent (not empty) when no contexts are configured.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-06T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path?: string, type = 'service'): GraphNode => {
  const result = createGraphNode({
    id,
    category: type === 'bounded-context' ? 'domain' : 'application',
    type,
    name,
    knowledge,
    ...(path === undefined ? {} : { path }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, from: string, to: string, type = 'IMPORTS'): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
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

/** Base component nodes: a deals service and a billing service in separate directories. */
const deals = node('svc:deals', 'DealService', 'src/deals/service.ts');
const billing = node('svc:billing', 'BillingService', 'src/billing/service.ts');

/** Context overlay fixtures — what `withConfiguredContexts` emits at read time. */
const contextNodes = [
  node('bounded-context:deals', 'deals', undefined, 'bounded-context'),
  node('bounded-context:billing', 'billing', undefined, 'bounded-context'),
];
const membership = (member: GraphNode, context: string): GraphEdge =>
  edge(
    `edge:belongs:${member.id}:${context}`,
    member.id,
    `bounded-context:${context}`,
    'BELONGS_TO_CONTEXT',
  );
const contextEdges = [membership(deals, 'deals'), membership(billing, 'billing')];

const request = (overrides: Partial<ClassifyDriftRequest>): ClassifyDriftRequest => ({
  analysis: analysisOf([impact('svc:deals')]),
  approvedGraph: graph([deals, billing], []),
  currentGraph: graph([deals, billing], []),
  edgeChanges: { added: [], removed: [] },
  changedFiles: ['src/billing/service.ts'],
  ...overrides,
});

describe('classifyDrift — categories', () => {
  it('classifies an added edge between different configured contexts as cross-context', () => {
    const dependency = edge('e-billing-deals', 'svc:billing', 'svc:deals');
    const result = classifyDrift(
      request({
        approvedGraph: graph([deals, billing, ...contextNodes], contextEdges),
        currentGraph: graph([deals, billing, ...contextNodes], [...contextEdges, dependency]),
        edgeChanges: { added: ['e-billing-deals'], removed: [] },
      }),
    );
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.category).toBe('cross-context');
    expect(entry?.direction).toBe('added');
    expect(entry?.edgeType).toBe('IMPORTS');
    expect(entry?.from).toMatchObject({
      nodeId: 'svc:billing',
      nodeName: 'BillingService',
      context: 'billing',
    });
    expect(entry?.to).toMatchObject({
      nodeId: 'svc:deals',
      nodeName: 'DealService',
      context: 'deals',
    });
  });

  it('never produces cross-context when no contexts are configured', () => {
    const dependency = edge('e-billing-deals', 'svc:billing', 'svc:deals');
    const result = classifyDrift(
      request({
        currentGraph: graph([deals, billing], [dependency]),
        edgeChanges: { added: ['e-billing-deals'], removed: [] },
      }),
    );
    // Both endpoints pre-existed, so without a known boundary this is a new dependency.
    expect(result.entries[0]?.category).toBe('new-dependency');
    expect(result.entries[0]?.from.context).toBeUndefined();
    expect(result.unmappedContexts).toBeUndefined();
  });

  it('classifies edges across registered repositories only when attribution is injected', () => {
    const dependency = edge('e-cross-repo', 'svc:billing', 'svc:deals');
    const currentGraph = graph([deals, billing], [dependency]);
    const attributed = classifyDrift(
      request({
        currentGraph,
        edgeChanges: { added: ['e-cross-repo'], removed: [] },
        owningRepositoryOf: (path) =>
          path?.startsWith('src/billing/') === true ? 'billing-repo' : '(workspace root)',
      }),
    );
    expect(attributed.entries[0]?.category).toBe('cross-repository');
    expect(attributed.entries[0]?.from.repository).toBe('billing-repo');
    expect(attributed.entries[0]?.to.repository).toBe('(workspace root)');

    const unattributed = classifyDrift(
      request({ currentGraph, edgeChanges: { added: ['e-cross-repo'], removed: [] } }),
    );
    expect(unattributed.entries[0]?.category).toBe('new-dependency');
  });

  it('classifies a removed edge whose endpoints both survive as removed-dependency', () => {
    const dependency = edge('e-removed', 'svc:billing', 'svc:deals');
    const result = classifyDrift(
      request({
        approvedGraph: graph([deals, billing], [dependency]),
        edgeChanges: { added: [], removed: ['e-removed'] },
      }),
    );
    expect(result.entries[0]?.category).toBe('removed-dependency');
    expect(result.entries[0]?.direction).toBe('removed');
  });

  it('classifies an edge to a brand-new node as other, not new-dependency', () => {
    const fresh = node('svc:fresh', 'FreshService', 'src/billing/fresh.ts');
    const dependency = edge('e-fresh', 'svc:billing', 'svc:fresh');
    const result = classifyDrift(
      request({
        currentGraph: graph([deals, billing, fresh], [dependency]),
        edgeChanges: { added: ['e-fresh'], removed: [] },
      }),
    );
    expect(result.entries[0]?.category).toBe('other');
  });

  it('detects a direction reversal from a removed A→B plus an added B→A of the same type', () => {
    const forward = edge('e-forward', 'svc:deals', 'svc:billing', 'CALLS');
    const backward = edge('e-backward', 'svc:billing', 'svc:deals', 'CALLS');
    const result = classifyDrift(
      request({
        approvedGraph: graph([deals, billing], [forward]),
        currentGraph: graph([deals, billing], [backward]),
        edgeChanges: { added: ['e-backward'], removed: ['e-forward'] },
      }),
    );
    expect(result.entries.map((entry) => entry.category)).toEqual([
      'direction-reversal',
      'direction-reversal',
    ]);
  });

  it('skips unresolvable edge ids and read-time membership edges', () => {
    const result = classifyDrift(
      request({
        currentGraph: graph([deals, billing, ...contextNodes], contextEdges),
        edgeChanges: {
          added: ['edge:belongs:svc:deals:deals', 'e-vanished'],
          removed: [],
        },
      }),
    );
    expect(result.entries).toHaveLength(0);
  });
});

describe('classifyDrift — bounds', () => {
  it('caps each category and counts what the cap cut', () => {
    const extra = DRIFT_ENTRY_LIMIT + 3;
    const freshNodes = Array.from({ length: extra }, (_, i) =>
      node(`svc:new-${String(i)}`, `New${String(i)}`, `src/deals/new-${String(i)}.ts`),
    );
    const added = freshNodes.map((fresh, i) =>
      edge(`e-add-${String(i).padStart(2, '0')}`, 'svc:deals', fresh.id),
    );
    const result = classifyDrift(
      request({
        currentGraph: graph([deals, billing, ...freshNodes], added),
        edgeChanges: { added: added.map((entry) => entry.id), removed: [] },
      }),
    );
    expect(result.entries).toHaveLength(DRIFT_ENTRY_LIMIT);
    expect(result.omitted).toEqual([{ category: 'other', count: 3 }]);
    // Deterministic order: sorted by edge id within the category.
    expect(result.entries[0]?.edgeId).toBe('e-add-00');
  });
});

describe('classifyDrift — unmapped context touches', () => {
  it('names configured contexts the diff touched that no predictive impact maps to', () => {
    const result = classifyDrift(
      request({
        approvedGraph: graph([deals, billing, ...contextNodes], contextEdges),
        currentGraph: graph([deals, billing, ...contextNodes], contextEdges),
        changedFiles: ['src/billing/service.ts', 'src/deals/service.ts'],
      }),
    );
    // The approved analysis predicts only svc:deals → the deals context is the footprint;
    // billing is a touched context outside it.
    expect(result.unmappedContexts).toEqual({ contexts: ['billing'] });
  });

  it('reports an empty list (assessed, none) when every touched context is in the footprint', () => {
    const result = classifyDrift(
      request({
        approvedGraph: graph([deals, billing, ...contextNodes], contextEdges),
        currentGraph: graph([deals, billing, ...contextNodes], contextEdges),
        changedFiles: ['src/deals/service.ts'],
      }),
    );
    expect(result.unmappedContexts).toEqual({ contexts: [] });
  });
});
