import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  contextsBlock,
  contractsBlock,
  integrationPointsBlock,
  repositoryBlocks,
} from './architecture-boundaries.js';
import { WORKSPACE_ROOT_REPOSITORY } from './repository-attribution.js';

import type { RegisteredRepository, RepositoryRoster } from './registered-repositories.js';
import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Item 6 — the query_architecture boundary blocks, derived at answer time.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-06T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, category: string, type: string, path?: string): GraphNode => {
  const created = createGraphNode({
    id,
    name: id.includes(':') ? (id.split(':').pop() ?? id) : id,
    category,
    type,
    ...(path === undefined ? {} : { path }),
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${id}`);
  }
  return created.value;
};

const graphOf = (nodes: readonly GraphNode[]): KnowledgeGraph => {
  const created = createKnowledgeGraph(nodes, []);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

describe('contextsBlock', () => {
  it('is absent when no contexts are declared', () => {
    const graph = graphOf([node('file:a', 'repository', 'file', 'src/a.ts')]);
    expect(contextsBlock(graph, { schemaVersion: 1 })).toBeUndefined();
  });

  it('reports member counts and bounded sample paths per declared context', () => {
    const graph = graphOf([
      node('file:src/deals/a.ts', 'repository', 'file', 'src/deals/a.ts'),
      node('file:src/deals/b.ts', 'repository', 'file', 'src/deals/b.ts'),
      node('file:src/other.ts', 'repository', 'file', 'src/other.ts'),
    ]);
    expect(
      contextsBlock(graph, {
        schemaVersion: 1,
        contexts: [
          { name: 'deals', paths: ['src/deals/**'] },
          { name: 'empty', paths: ['nowhere/**'] },
        ],
      }),
    ).toEqual([
      {
        name: 'deals',
        memberCount: 2,
        samplePaths: ['src/deals/a.ts', 'src/deals/b.ts'],
      },
      { name: 'empty', memberCount: 0 },
    ]);
  });
});

describe('integrationPointsBlock', () => {
  it('is absent when the graph has no integration-point nodes', () => {
    const graph = graphOf([node('file:a', 'repository', 'file', 'src/a.ts')]);
    expect(integrationPointsBlock(graph)).toBeUndefined();
  });

  it('counts by node type over the integration and contract families', () => {
    const graph = graphOf([
      node('topic:orders', 'integration', 'topic'),
      node('topic:deals', 'integration', 'topic'),
      node('webhook:pay', 'integration', 'webhook'),
      node('boundary:crm', 'integration', 'unresolved-external-boundary'),
      node('openapi:api', 'asset', 'openapi-document', 'docs/api.yml'),
      node('file:a', 'repository', 'file', 'src/a.ts'),
    ]);
    expect(integrationPointsBlock(graph)).toEqual({
      topic: 2,
      webhook: 1,
      'unresolved-external-boundary': 1,
      'openapi-document': 1,
    });
  });
});

describe('contractsBlock', () => {
  it('inventories OpenAPI documents and generated contracts with their paths', () => {
    const graph = graphOf([
      node('openapi:billing-api', 'asset', 'openapi-document', 'docs/billing.yml'),
      node('contract:events', 'asset', 'generated-contract', 'src/generated/events.ts'),
      node('file:a', 'repository', 'file', 'src/a.ts'),
    ]);
    expect(contractsBlock(graph)).toEqual([
      { name: 'billing-api', type: 'openapi-document', path: 'docs/billing.yml' },
      { name: 'events', type: 'generated-contract', path: 'src/generated/events.ts' },
    ]);
  });

  it('is absent when the graph declares no contracts', () => {
    expect(
      contractsBlock(graphOf([node('file:a', 'repository', 'file', 'src/a.ts')])),
    ).toBeUndefined();
  });
});

const member = (name: string, resolvedPath?: string): RegisteredRepository => ({
  name,
  declaredPath: name === WORKSPACE_ROOT_REPOSITORY ? '.' : name,
  ...(resolvedPath === undefined ? {} : { resolvedPath }),
  present: resolvedPath !== undefined,
  enabled: true,
});

const rosterOf = (members: readonly RegisteredRepository[]): RepositoryRoster => ({
  members,
  absent: [],
  limitations: [],
});

describe('repositoryBlocks', () => {
  const graph = graphOf([
    node('file:src/a.ts', 'repository', 'file', 'src/a.ts'),
    node('file:billing/api.ts', 'repository', 'file', 'billing/api.ts'),
  ]);

  it('emits neither block when only the workspace root exists — no noise for single repos', () => {
    const roster = rosterOf([member(WORKSPACE_ROOT_REPOSITORY, '/ws')]);
    expect(repositoryBlocks(graph, roster, () => undefined)).toEqual({});
  });

  it('breaks the graph down per registered repository and reports cross-repository edges', () => {
    const roster = rosterOf([
      member(WORKSPACE_ROOT_REPOSITORY, '/ws'),
      member('billing', '/ws/billing'),
    ]);
    const blocks = repositoryBlocks(graph, roster, (entry) =>
      entry.name === 'billing' ? 'billing' : undefined,
    );
    expect(blocks.repositories).toEqual([
      { name: WORKSPACE_ROOT_REPOSITORY, nodeCount: 1, fileCount: 1 },
      { name: 'billing', nodeCount: 1, fileCount: 1 },
    ]);
    expect(blocks.crossRepositoryEdges).toEqual({ count: 0, samples: [] });
  });
});
