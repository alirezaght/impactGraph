import { describe, expect, it } from 'vitest';

import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  extractSubgraph,
  findNodes,
  findShortestPath,
  neighbors,
} from '../index.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '../index.js';

const envelope = (provenance: string) => ({
  provenance,
  evidenceIds: ['ev-1'],
  confidence: { value: 0.9, signals: [{ type: 'direct-import' as const, contribution: 0.9 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
});

interface NodeSpec {
  id: string;
  category?: string;
  type?: string;
  name?: string;
  path?: string;
  provenance?: string;
}

const node = (spec: NodeSpec): GraphNode => {
  const result = createGraphNode({
    id: spec.id,
    category: spec.category ?? 'application',
    type: spec.type ?? 'service',
    name: spec.name ?? spec.id,
    ...(spec.path === undefined ? {} : { path: spec.path }),
    knowledge: envelope(spec.provenance ?? 'static-analysis'),
  });
  if (!result.ok) {
    throw new Error(`fixture node ${spec.id} invalid`);
  }
  return result.value;
};

interface EdgeSpec {
  id: string;
  type: string;
  from: string;
  to: string;
  provenance?: string;
}

const edge = (spec: EdgeSpec): GraphEdge => {
  const result = createGraphEdge({
    id: spec.id,
    type: spec.type,
    sourceId: spec.from,
    targetId: spec.to,
    knowledge: envelope(spec.provenance ?? 'static-analysis'),
  });
  if (!result.ok) {
    throw new Error(`fixture edge ${spec.id} invalid`);
  }
  return result.value;
};

// Deterministic backbone: DealService --IMPORTS--> DealRepository --WRITES_TO--> deals table;
// DealService --PUBLISHES--> deal-updated <--SUBSCRIBES_TO-- SearchIndexer.
// AI layer: MAY_AFFECT DealService -> SearchIndexer, and an inferred Search bounded context.
const fixtureGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node({ id: 'deal-service', name: 'DealService', path: 'src/deals/DealService.ts' }),
      node({ id: 'deal-repository', name: 'DealRepository', path: 'src/deals/DealRepository.ts' }),
      node({ id: 'deal-updated', category: 'integration', type: 'topic', name: 'deal-updated' }),
      node({ id: 'search-indexer', name: 'SearchIndexer', path: 'src/search/SearchIndexer.ts' }),
      node({ id: 'deals-table', category: 'data', type: 'table', name: 'deals' }),
      node({
        id: 'search-context',
        category: 'domain',
        type: 'bounded-context',
        name: 'Search',
        provenance: 'llm-inferred',
      }),
    ],
    [
      edge({ id: 'e-imports', type: 'IMPORTS', from: 'deal-service', to: 'deal-repository' }),
      edge({ id: 'e-publishes', type: 'PUBLISHES', from: 'deal-service', to: 'deal-updated' }),
      edge({
        id: 'e-subscribes',
        type: 'SUBSCRIBES_TO',
        from: 'search-indexer',
        to: 'deal-updated',
      }),
      edge({
        id: 'e-may-affect',
        type: 'MAY_AFFECT',
        from: 'deal-service',
        to: 'search-indexer',
        provenance: 'llm-inferred',
      }),
      edge({ id: 'e-writes', type: 'WRITES_TO', from: 'deal-repository', to: 'deals-table' }),
      edge({
        id: 'e-belongs',
        type: 'BELONGS_TO_CONTEXT',
        from: 'search-indexer',
        to: 'search-context',
        provenance: 'llm-inferred',
      }),
    ],
  );
  if (!result.ok) {
    throw new Error('fixture graph invalid');
  }
  return result.value;
};

describe('findNodes (Story 1.4)', () => {
  it('finds nodes by category, type, name, and path', () => {
    const graph = fixtureGraph();
    expect(findNodes(graph, { category: 'data' }).map((n) => n.id)).toEqual(['deals-table']);
    expect(findNodes(graph, { type: 'topic' }).map((n) => n.id)).toEqual(['deal-updated']);
    expect(findNodes(graph, { name: 'DealService' }).map((n) => n.id)).toEqual(['deal-service']);
    expect(findNodes(graph, { path: 'src/deals/DealRepository.ts' }).map((n) => n.id)).toEqual([
      'deal-repository',
    ]);
  });

  it('filters by knowledge category — facts only vs include inferences (§3, §47.10)', () => {
    const graph = fixtureGraph();
    const facts = findNodes(graph, { knowledgeCategories: ['deterministic'] });
    expect(facts.map((n) => n.id)).not.toContain('search-context');
    const all = findNodes(graph, {});
    expect(all.map((n) => n.id)).toContain('search-context');
  });

  it('returns results in stable id order regardless of insertion order (§34)', () => {
    const graph = fixtureGraph();
    const ids = findNodes(graph, { category: 'application' }).map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('neighbors (Story 1.4)', () => {
  it('returns outgoing, incoming, or both neighborhoods', () => {
    const graph = fixtureGraph();
    expect(neighbors(graph, 'deal-service', { direction: 'outgoing' }).map((n) => n.id)).toEqual([
      'deal-repository',
      'deal-updated',
      'search-indexer',
    ]);
    expect(neighbors(graph, 'deal-updated', { direction: 'incoming' }).map((n) => n.id)).toEqual([
      'deal-service',
      'search-indexer',
    ]);
    expect(neighbors(graph, 'deal-repository', { direction: 'both' }).map((n) => n.id)).toEqual([
      'deal-service',
      'deals-table',
    ]);
  });

  it('filters by edge type and by edge knowledge category', () => {
    const graph = fixtureGraph();
    expect(
      neighbors(graph, 'deal-service', { direction: 'outgoing', edgeTypes: ['PUBLISHES'] }).map(
        (n) => n.id,
      ),
    ).toEqual(['deal-updated']);
    expect(
      neighbors(graph, 'deal-service', {
        direction: 'outgoing',
        knowledgeCategories: ['deterministic'],
      }).map((n) => n.id),
    ).toEqual(['deal-repository', 'deal-updated']);
  });

  it('returns empty for unknown nodes', () => {
    expect(neighbors(fixtureGraph(), 'ghost', { direction: 'both' })).toEqual([]);
  });
});

describe('findShortestPath (Story 1.4)', () => {
  it('finds the direct inferred edge when everything is traversable', () => {
    const graph = fixtureGraph();
    const path = findShortestPath(graph, 'deal-service', 'search-indexer', { direction: 'both' });
    expect(path?.edges.map((e) => e.id)).toEqual(['e-may-affect']);
  });

  it('routes through the event topic when restricted to deterministic facts', () => {
    const graph = fixtureGraph();
    const path = findShortestPath(graph, 'deal-service', 'search-indexer', {
      direction: 'both',
      knowledgeCategories: ['deterministic'],
    });
    expect(path?.nodes.map((n) => n.id)).toEqual([
      'deal-service',
      'deal-updated',
      'search-indexer',
    ]);
    expect(path?.edges.map((e) => e.id)).toEqual(['e-publishes', 'e-subscribes']);
  });

  it('respects direction and edge-type filters', () => {
    const graph = fixtureGraph();
    const outgoingOnly = findShortestPath(graph, 'deal-service', 'search-indexer', {
      direction: 'outgoing',
      knowledgeCategories: ['deterministic'],
    });
    expect(outgoingOnly).toBeUndefined();

    const importsOnly = findShortestPath(graph, 'deal-service', 'deals-table', {
      direction: 'outgoing',
      edgeTypes: ['IMPORTS'],
    });
    expect(importsOnly).toBeUndefined();
  });

  it('handles trivial and impossible paths', () => {
    const graph = fixtureGraph();
    const self = findShortestPath(graph, 'deal-service', 'deal-service', { direction: 'both' });
    expect(self?.nodes.map((n) => n.id)).toEqual(['deal-service']);
    expect(self?.edges).toEqual([]);
    expect(findShortestPath(graph, 'deal-service', 'ghost', { direction: 'both' })).toBeUndefined();
  });
});

describe('extractSubgraph (Story 1.4)', () => {
  it('extracts the induced subgraph around seeds up to a depth', () => {
    const graph = fixtureGraph();
    const sub = extractSubgraph(graph, ['deal-updated'], { direction: 'both', maxDepth: 1 });
    expect([...sub.nodes.keys()].sort()).toEqual([
      'deal-service',
      'deal-updated',
      'search-indexer',
    ]);
    expect([...sub.edges.keys()].sort()).toEqual(['e-may-affect', 'e-publishes', 'e-subscribes']);
  });

  it('excludes inferred nodes and edges when restricted to deterministic facts', () => {
    const graph = fixtureGraph();
    const sub = extractSubgraph(graph, ['search-indexer'], {
      direction: 'both',
      maxDepth: 1,
      knowledgeCategories: ['deterministic'],
    });
    expect([...sub.nodes.keys()].sort()).toEqual(['deal-updated', 'search-indexer']);
    expect([...sub.edges.keys()]).toEqual(['e-subscribes']);
  });

  it('is itself a queryable graph', () => {
    const graph = fixtureGraph();
    const sub = extractSubgraph(graph, ['deal-service'], { direction: 'outgoing', maxDepth: 1 });
    expect(findNodes(sub, { type: 'topic' }).map((n) => n.id)).toEqual(['deal-updated']);
  });
});

describe('scale sanity (PRD §33 — 5,000-node synthetic graph)', () => {
  it('constructs and queries a 5,000-node chain', () => {
    const count = 5000;
    const nodes = Array.from({ length: count }, (_, i) =>
      node({ id: `n-${String(i).padStart(5, '0')}` }),
    );
    const edges = Array.from({ length: count - 1 }, (_, i) =>
      edge({
        id: `e-${String(i).padStart(5, '0')}`,
        type: 'CALLS',
        from: `n-${String(i).padStart(5, '0')}`,
        to: `n-${String(i + 1).padStart(5, '0')}`,
      }),
    );
    const result = createKnowledgeGraph(nodes, edges);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const path = findShortestPath(
      result.value,
      'n-00000',
      `n-${String(count - 1).padStart(5, '0')}`,
      {
        direction: 'outgoing',
      },
    );
    expect(path?.edges).toHaveLength(count - 1);
    expect(findNodes(result.value, { category: 'application' })).toHaveLength(count);
  });
});
