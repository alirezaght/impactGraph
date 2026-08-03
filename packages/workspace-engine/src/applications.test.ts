import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { applicationsForGraph } from './overlay.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// §18.4 "group by application". Ownership is WALKED over CONTAINS, never inferred from the path —
// a component in `apps/worker/src` owned by no declared package must come back unowned, because
// guessing from a path prefix is exactly the heuristic the context work refused.

const knowledge = {
  provenance: 'configuration',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, type: string, name: string, category = 'repository'): GraphNode => {
  const created = createGraphNode({ id, type, name, category, knowledge });
  if (!created.ok) {
    throw new Error(`node ${id}: ${created.error.issues[0]?.message ?? ''}`);
  }
  return created.value;
};

const contains = (id: string, from: string, to: string): GraphEdge => {
  const created = createGraphEdge({
    id,
    type: 'CONTAINS',
    sourceId: from,
    targetId: to,
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`edge ${id}`);
  }
  return created.value;
};

const graph = (): KnowledgeGraph => {
  const created = createKnowledgeGraph(
    [
      node('package:api', 'package', '@fixture/api'),
      node('file:api', 'file', 'index.ts'),
      node('symbol:handler', 'function', 'handler', 'application'),
      node('package:core', 'package', '@fixture/core'),
      node('file:core', 'file', 'core.ts'),
      // Declared by no package — must stay unowned.
      node('file:orphan', 'file', 'stray.ts'),
    ],
    [
      contains('e1', 'package:api', 'file:api'),
      // transitive: package → file → symbol
      contains('e2', 'file:api', 'symbol:handler'),
      contains('e3', 'package:core', 'file:core'),
    ],
  );
  if (!created.ok) {
    throw new Error('graph invalid');
  }
  return created.value;
};

describe('application ownership (§18.4 group-by-application)', () => {
  const owners = applicationsForGraph(graph());

  it('owns a file directly contained by a package', () => {
    expect(owners.get('file:api')).toBe('@fixture/api');
  });

  it('owns a symbol TRANSITIVELY — package → file → symbol', () => {
    expect(owners.get('symbol:handler')).toBe('@fixture/api');
  });

  it('keeps packages distinct', () => {
    expect(owners.get('file:core')).toBe('@fixture/core');
  });

  it('a node no package contains is UNOWNED — never guessed from its path', () => {
    expect(owners.has('file:orphan')).toBe(false);
  });

  it('the package nodes themselves are not owned by themselves', () => {
    expect(owners.has('package:api')).toBe(false);
  });
});
