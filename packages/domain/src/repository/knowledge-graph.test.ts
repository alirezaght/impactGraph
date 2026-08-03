import { describe, expect, it } from 'vitest';

import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '../index.js';

import type { GraphEdge, GraphNode, KnowledgeEnvelopeInput } from '../index.js';

const envelope: KnowledgeEnvelopeInput = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'application',
    type: 'service',
    name: id,
    knowledge: envelope,
  });
  if (!result.ok) {
    throw new Error(`fixture node ${id} invalid`);
  }
  return result.value;
};

const edge = (id: string, sourceId: string, targetId: string): GraphEdge => {
  const result = createGraphEdge({ id, type: 'IMPORTS', sourceId, targetId, knowledge: envelope });
  if (!result.ok) {
    throw new Error(`fixture edge ${id} invalid`);
  }
  return result.value;
};

describe('createKnowledgeGraph (Story 1.4)', () => {
  it('builds a frozen graph with node and edge lookups', () => {
    const result = createKnowledgeGraph([node('a'), node('b')], [edge('e1', 'a', 'b')]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.size).toBe(2);
      expect(result.value.edges.size).toBe(1);
      expect(result.value.nodes.get('a' as never)?.name).toBe('a');
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('rejects duplicate node ids and duplicate edge ids', () => {
    const dupNode = createKnowledgeGraph([node('a'), node('a')], []);
    expect(dupNode.ok).toBe(false);
    if (!dupNode.ok) {
      expect(dupNode.error.issues.some((i) => i.code === 'duplicate-id')).toBe(true);
    }

    const dupEdge = createKnowledgeGraph(
      [node('a'), node('b')],
      [edge('e1', 'a', 'b'), edge('e1', 'b', 'a')],
    );
    expect(dupEdge.ok).toBe(false);
  });

  it('rejects edges referencing nodes that do not exist (CLAUDE.md rule 4)', () => {
    const result = createKnowledgeGraph([node('a')], [edge('e1', 'a', 'ghost')]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'unknown-node-reference')).toBe(true);
      expect(result.error.issues[0]?.path).toContain('e1');
    }
  });

  it('accepts an empty graph', () => {
    const result = createKnowledgeGraph([], []);
    expect(result.ok).toBe(true);
  });
});
