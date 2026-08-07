import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { withConfiguredContexts, configuredContextMembers } from './overlay-context-graph.js';

import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type { GraphNode, KnowledgeGraph, NodeId } from '@impactgraph/domain';

// Item 6 — declared bounded contexts become read-time graph knowledge: a `bounded-context`
// node per configured context, a `BELONGS_TO_CONTEXT` edge per structural member, provenance
// `configuration`, and the input graph is never mutated.

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
    name: id,
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

const GRAPH = graphOf([
  node('file:src/deals/service.ts', 'repository', 'file', 'src/deals/service.ts'),
  node('file:src/billing/api.ts', 'repository', 'file', 'src/billing/api.ts'),
  node('sym:deal-service', 'application', 'service', 'src/deals/service.ts'),
  node('pkg:deals', 'repository', 'package', 'src/deals/package.json'),
]);

const CONFIG: ArchitectureConfigDto = {
  schemaVersion: 1,
  contexts: [{ name: 'deals', paths: ['src/deals/**'] }],
};

const META = { snapshotId: 'snap-1', createdAt: '2026-08-06T11:00:00.000Z' };

describe('withConfiguredContexts', () => {
  it('returns the input graph unchanged when no contexts are configured', () => {
    expect(withConfiguredContexts(GRAPH, { schemaVersion: 1 }, META)).toBe(GRAPH);
  });

  it('emits one bounded-context node per declared context', () => {
    const augmented = withConfiguredContexts(GRAPH, CONFIG, META);
    const context = augmented.nodes.get('bounded-context:deals' as NodeId);
    expect(context?.type).toBe('bounded-context');
    expect(context?.category).toBe('domain');
    expect(context?.name).toBe('deals');
  });

  it('emits BELONGS_TO_CONTEXT edges from matching files and packages, not symbols', () => {
    const augmented = withConfiguredContexts(GRAPH, CONFIG, META);
    const belongs = [...augmented.edges.values()].filter(
      (edge) => edge.type === 'BELONGS_TO_CONTEXT',
    );
    expect(belongs.map((edge) => edge.sourceId).sort()).toEqual([
      'file:src/deals/service.ts',
      'pkg:deals',
    ]);
    expect(belongs.every((edge) => edge.targetId === 'bounded-context:deals')).toBe(true);
  });

  it('carries configuration provenance, evidence, and the snapshot id on every emission', () => {
    const augmented = withConfiguredContexts(GRAPH, CONFIG, META);
    const context = augmented.nodes.get('bounded-context:deals' as NodeId);
    const edge = [...augmented.edges.values()].find((entry) => entry.type === 'BELONGS_TO_CONTEXT');
    for (const emitted of [context?.knowledge, edge?.knowledge]) {
      expect(emitted?.provenance).toBe('configuration');
      expect(emitted?.repositorySnapshotId).toBe('snap-1');
      expect(emitted?.evidenceIds[0]).toContain('architecture.yml#context:deals');
    }
  });

  it('never mutates the input graph', () => {
    const before = GRAPH.nodes.size;
    withConfiguredContexts(GRAPH, CONFIG, META);
    expect(GRAPH.nodes.size).toBe(before);
    expect([...GRAPH.edges.values()].some((edge) => edge.type === 'BELONGS_TO_CONTEXT')).toBe(
      false,
    );
  });

  it('includes members assigned via a component entry naming the context', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['src/deals/**'] }],
      components: [{ path: 'src/billing/api.ts', context: 'deals' }],
    };
    const members = configuredContextMembers(GRAPH, config);
    expect(members.get('deals')?.map((member) => member.id)).toContain('file:src/billing/api.ts');
  });
});
