import { describe, expect, it } from 'vitest';

import { createGraphEdge, createGraphNode, createKnowledgeGraph, resolveMember } from '../index.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '../index.js';

const envelope = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 0.9, signals: [{ type: 'direct-import' as const, contribution: 0.9 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

interface NodeSpec {
  id: string;
  category?: string;
  type?: string;
  name?: string;
}

const node = (spec: NodeSpec): GraphNode => {
  const result = createGraphNode({
    id: spec.id,
    category: spec.category ?? 'application',
    type: spec.type ?? 'class',
    name: spec.name ?? spec.id,
    knowledge: envelope,
  });
  if (!result.ok) {
    throw new Error(`fixture node ${spec.id} invalid`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge: envelope });
  if (!result.ok) {
    throw new Error(`fixture edge ${id} invalid`);
  }
  return result.value;
};

const graphOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('fixture graph invalid');
  }
  return result.value;
};

const MEMBER_TYPES: ReadonlySet<string> = new Set(['method', 'field', 'enum-member']);
const options = { memberTypes: MEMBER_TYPES };

const container = (graph: KnowledgeGraph, id: string): GraphNode => {
  const found = graph.nodes.get(id as never);
  if (found === undefined) {
    throw new Error(`missing container ${id}`);
  }
  return found;
};

/** The field case: `list_rows` lives on a mixin the repository class EXTENDS. */
const mixinGraph = (): KnowledgeGraph =>
  graphOf(
    [
      node({ id: 'c:repo', name: 'SqlOutboundQueueRepository' }),
      node({ id: 'c:mixin', name: 'OutboundAuditReadsMixin' }),
      node({ id: 'm:own', type: 'method', name: 'SqlOutboundQueueRepository.save' }),
      node({ id: 'm:list', type: 'method', name: 'OutboundAuditReadsMixin.list_rows' }),
    ],
    [
      edge('e1', 'CONTAINS', 'c:repo', 'm:own'),
      edge('e2', 'CONTAINS', 'c:mixin', 'm:list'),
      edge('e3', 'EXTENDS', 'c:repo', 'c:mixin'),
    ],
  );

describe('resolveMember — inheritance-aware member resolution', () => {
  it('finds a member the container declares itself', () => {
    const graph = mixinGraph();
    const resolution = resolveMember(graph, container(graph, 'c:repo'), 'save', options);
    expect(resolution.outcome).toBe('found');
    if (resolution.outcome === 'found') {
      expect(resolution.inherited).toBe(false);
      expect(resolution.provider.id).toBe('c:repo');
    }
  });

  it('finds a member declared on an EXTENDS-reachable mixin, marked inherited', () => {
    const graph = mixinGraph();
    const resolution = resolveMember(graph, container(graph, 'c:repo'), 'list_rows', options);
    expect(resolution.outcome).toBe('found');
    if (resolution.outcome === 'found') {
      expect(resolution.inherited).toBe(true);
      expect(resolution.provider.id).toBe('c:mixin');
      expect(resolution.member.name).toBe('OutboundAuditReadsMixin.list_rows');
    }
  });

  it('follows IMPLEMENTS edges and multi-level chains', () => {
    const graph = graphOf(
      [
        node({ id: 'c:a', name: 'A' }),
        node({ id: 'c:b', name: 'B' }),
        node({ id: 'c:i', type: 'interface', name: 'Readable' }),
        node({ id: 'm:read', type: 'method', name: 'Readable.read' }),
      ],
      [
        edge('e1', 'EXTENDS', 'c:a', 'c:b'),
        edge('e2', 'IMPLEMENTS', 'c:b', 'c:i'),
        edge('e3', 'CONTAINS', 'c:i', 'm:read'),
      ],
    );
    const resolution = resolveMember(graph, container(graph, 'c:a'), 'read', options);
    expect(resolution.outcome).toBe('found');
    if (resolution.outcome === 'found') {
      expect(resolution.inherited).toBe(true);
      expect(resolution.provider.id).toBe('c:i');
    }
  });

  it('terminates on inheritance cycles and reports not-found in a closed world', () => {
    const graph = graphOf(
      [
        node({ id: 'c:a', name: 'A' }),
        node({ id: 'c:b', name: 'B' }),
        node({ id: 'm:x', type: 'method', name: 'A.x' }),
      ],
      [
        edge('e1', 'EXTENDS', 'c:a', 'c:b'),
        edge('e2', 'EXTENDS', 'c:b', 'c:a'),
        edge('e3', 'CONTAINS', 'c:a', 'm:x'),
      ],
    );
    const resolution = resolveMember(graph, container(graph, 'c:a'), 'missing', options);
    expect(resolution.outcome).toBe('not-found');
    if (resolution.outcome === 'not-found') {
      expect(resolution.memberSetOpen).toBe(false);
      expect(resolution.declaredMemberNames).toEqual(['x']);
    }
  });

  it('stops descending at the depth bound instead of walking forever', () => {
    const nodes: GraphNode[] = [node({ id: 'c:0', name: 'C0' })];
    const edges: GraphEdge[] = [];
    for (let level = 1; level <= 20; level += 1) {
      nodes.push(node({ id: `c:${String(level)}`, name: `C${String(level)}` }));
      edges.push(
        edge(`e${String(level)}`, 'EXTENDS', `c:${String(level - 1)}`, `c:${String(level)}`),
      );
    }
    nodes.push(node({ id: 'm:deep', type: 'method', name: 'C20.deep' }));
    edges.push(edge('em', 'CONTAINS', 'c:20', 'm:deep'));
    const graph = graphOf(nodes, edges);
    const resolution = resolveMember(graph, container(graph, 'c:0'), 'deep', {
      ...options,
      maxDepth: 4,
    });
    expect(resolution.outcome).toBe('not-found');
  });

  it('reports an open member set when a supertype is an unresolved external boundary', () => {
    const graph = graphOf(
      [
        node({ id: 'c:repo', name: 'SqlOutboundQueueRepository' }),
        node({
          id: 'ext:base',
          category: 'integration',
          type: 'unresolved-external-boundary',
          name: 'ExternalBase',
        }),
        node({ id: 'm:own', type: 'method', name: 'SqlOutboundQueueRepository.save' }),
      ],
      [edge('e1', 'EXTENDS', 'c:repo', 'ext:base'), edge('e2', 'CONTAINS', 'c:repo', 'm:own')],
    );
    const resolution = resolveMember(graph, container(graph, 'c:repo'), 'list_rows', options);
    expect(resolution.outcome).toBe('not-found');
    if (resolution.outcome === 'not-found') {
      expect(resolution.memberSetOpen).toBe(true);
      expect(resolution.resolvedSupertypeCount).toBe(0);
      expect(resolution.declaredMemberNames).toEqual(['save']);
    }
  });

  it('counts resolved supertypes and aggregates member names across the hierarchy', () => {
    const graph = mixinGraph();
    const resolution = resolveMember(graph, container(graph, 'c:repo'), 'absent', options);
    expect(resolution.outcome).toBe('not-found');
    if (resolution.outcome === 'not-found') {
      expect(resolution.memberSetOpen).toBe(false);
      expect(resolution.resolvedSupertypeCount).toBe(1);
      expect(resolution.declaredMemberNames).toEqual(['list_rows', 'save']);
      expect(resolution.declaredMemberTypes).toEqual(['method']);
    }
  });

  it('never traverses incoming EXTENDS edges — a subclass does not leak members upward', () => {
    const graph = mixinGraph();
    const resolution = resolveMember(graph, container(graph, 'c:mixin'), 'save', options);
    expect(resolution.outcome).toBe('not-found');
  });
});
