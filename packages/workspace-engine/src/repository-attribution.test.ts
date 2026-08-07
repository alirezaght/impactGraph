import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_ROOT_REPOSITORY,
  attributionPrefixes,
  componentsByRepository,
  crossRepositoryEdges,
  owningRepository,
  repositoryBreakdown,
} from './repository-attribution.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Item 6 — repository attribution derived from the roster's relative prefixes at answer time.
// Nothing is persisted on the node: the owner is recoverable from the rebased path alone.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-06T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, type: string, path?: string): GraphNode => {
  const created = createGraphNode({
    id,
    name: id,
    category: type === 'file' ? 'repository' : 'application',
    type,
    ...(path === undefined ? {} : { path }),
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${id}`);
  }
  return created.value;
};

const edge = (id: string, sourceId: string, targetId: string): GraphEdge => {
  const created = createGraphEdge({ id, type: 'IMPORTS', sourceId, targetId, knowledge });
  if (!created.ok) {
    throw new Error(`bad fixture edge: ${id}`);
  }
  return created.value;
};

const graphOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KnowledgeGraph => {
  const created = createKnowledgeGraph(nodes, edges);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const PREFIXES = attributionPrefixes([
  { name: WORKSPACE_ROOT_REPOSITORY },
  { name: 'billing', path: 'billing' },
  { name: 'billing-legacy', path: 'billing/legacy' },
  { name: 'ghost' }, // registered but absent: no prefix, attributes nothing
]);

describe('owningRepository', () => {
  it('attributes a path under no registered prefix to the workspace root', () => {
    expect(owningRepository(PREFIXES, 'src/services/deal-service.ts')).toBe(
      WORKSPACE_ROOT_REPOSITORY,
    );
  });

  it('attributes a prefixed path to its registered repository', () => {
    expect(owningRepository(PREFIXES, 'billing/src/billing-api.ts')).toBe('billing');
  });

  it('prefers the deepest prefix for nested repositories', () => {
    expect(owningRepository(PREFIXES, 'billing/legacy/src/old.ts')).toBe('billing-legacy');
  });

  it('does not attribute a sibling that merely shares the prefix string', () => {
    expect(owningRepository(PREFIXES, 'billing-portal/src/app.ts')).toBe(WORKSPACE_ROOT_REPOSITORY);
  });

  it('attributes a node without a path to the workspace root, never a guess', () => {
    expect(owningRepository(PREFIXES, undefined)).toBe(WORKSPACE_ROOT_REPOSITORY);
  });
});

const GRAPH = graphOf(
  [
    node('file:src/a.ts', 'file', 'src/a.ts'),
    node('sym:root-service', 'service', 'src/a.ts'),
    node('file:billing/api.ts', 'file', 'billing/api.ts'),
    node('sym:billing-api', 'service', 'billing/api.ts'),
  ],
  [
    edge('edge:cross', 'sym:root-service', 'sym:billing-api'),
    edge('edge:intra', 'file:src/a.ts', 'sym:root-service'),
  ],
);

describe('repositoryBreakdown', () => {
  it('counts nodes and files per repository, root first', () => {
    expect(repositoryBreakdown(GRAPH, PREFIXES)).toEqual([
      { name: WORKSPACE_ROOT_REPOSITORY, nodeCount: 2, fileCount: 1 },
      { name: 'billing', nodeCount: 2, fileCount: 1 },
      { name: 'billing-legacy', nodeCount: 0, fileCount: 0 },
    ]);
  });
});

describe('crossRepositoryEdges', () => {
  it('reports only edges whose endpoints live in different repositories', () => {
    const report = crossRepositoryEdges(GRAPH, PREFIXES);
    expect(report.count).toBe(1);
    expect(report.samples).toEqual([
      {
        from: 'sym:root-service',
        to: 'sym:billing-api',
        type: 'IMPORTS',
        repositories: [WORKSPACE_ROOT_REPOSITORY, 'billing'],
      },
    ]);
  });

  it('bounds the sample while reporting the full count', () => {
    const report = crossRepositoryEdges(GRAPH, PREFIXES, 0);
    expect(report.count).toBe(1);
    expect(report.samples).toEqual([]);
  });
});

describe('componentsByRepository', () => {
  it('counts distinct components per repository over the impacted node ids', () => {
    expect(
      componentsByRepository(
        ['sym:root-service', 'sym:root-service', 'sym:billing-api'],
        GRAPH,
        PREFIXES,
      ),
    ).toEqual({ [WORKSPACE_ROOT_REPOSITORY]: 1, billing: 1 });
  });
});
