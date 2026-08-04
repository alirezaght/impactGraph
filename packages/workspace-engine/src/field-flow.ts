import { queryOutcome } from '@impactgraph/domain';

import { transformationsForPaths } from './field-transformations.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { Failable } from './failure.js';
import type { DetectedTransformation } from './field-transformations.js';
import type { GraphNode, KnowledgeGraph, NodeId, QueryOutcome } from '@impactgraph/domain';

/**
 * Field-level flow queries (item 7).
 *
 * The five questions the trials asked for, answered from the graph the field-flow extractor built:
 * where does this field go, what consumes this payload field, what happens when it is null, where is
 * it renamed, does it cross a service boundary.
 *
 * Every answer carries a query outcome (item 11), because the interesting case is the empty one: "no
 * flow was found" and "field flow is only resolved within a file, and this field's consumer is in
 * another one" are opposite conclusions from the same empty list.
 */

/** One hop of a field's journey. */
export interface FlowHop {
  readonly nodeId: string;
  readonly name: string;
  readonly path?: string | undefined;
  /** The relationship that produced this hop. */
  readonly via: string;
  /** True when the target field is optional or nullable — the answer to "what if it is null?". */
  readonly nullable: boolean;
}

export interface FieldFlowResult {
  readonly field: { nodeId: string; name: string; path?: string | undefined; nullable: boolean };
  /** Forward flow: where the value goes. */
  readonly flowsTo: readonly FlowHop[];
  /** Backward flow: where the value came from. */
  readonly flowsFrom: readonly FlowHop[];
  /** Hops where the name changes — the answer to "where is it renamed?". */
  readonly renames: readonly FlowHop[];
  /**
   * Boundaries the flow reaches: routes, topics, contract documents, unresolved external boundaries.
   * The answer to "does it cross a service boundary?".
   */
  readonly boundaries: readonly FlowHop[];
  /**
   * Transformations the CODE shows acting on this value: null removal, row skipping, fallbacks,
   * merges, serialization. Each carries the evidence path, and only patterns the code states appear.
   */
  readonly transformations: readonly DetectedTransformation[];
  readonly outcome: QueryOutcome;
}

const FLOW_EDGES = new Set(['FLOWS_TO', 'RENAMED_TO', 'SERIALIZED_AS']);

const BOUNDARY_TYPES = new Set([
  'api-endpoint',
  'topic',
  'queue',
  'subscription',
  'pubsub-topic',
  'pubsub-subscription',
  'openapi-operation',
  'openapi-document',
  'external-api',
  'third-party-service',
  'unresolved-external-boundary',
  'outbox-record',
  'push-endpoint',
]);

/** A field node's name carries `?` when the declaration was optional or nullable. */
const isNullable = (node: GraphNode): boolean => node.name.endsWith('?');

const hopFor = (node: GraphNode, via: string): FlowHop => ({
  nodeId: node.id,
  name: node.name,
  path: node.path,
  via,
  nullable: isNullable(node),
});

const MAX_HOPS = 12;

/** Breadth-first walk over flow edges in one direction, bounded. */
interface WalkState {
  readonly hops: FlowHop[];
  readonly expanded: Set<string>;
  readonly recorded: Set<string>;
  readonly next: string[];
}

/** One node's flow edges: record each (node, relationship) once, expand each node once. */
const stepFlowEdges = (
  graph: KnowledgeGraph,
  state: WalkState,
  current: string,
  direction: 'forward' | 'backward',
): void => {
  const edgeIds =
    direction === 'forward'
      ? (graph.outgoing.get(current as NodeId) ?? [])
      : (graph.incoming.get(current as NodeId) ?? []);
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || !FLOW_EDGES.has(edge.type)) {
      continue;
    }
    const otherId = direction === 'forward' ? edge.targetId : edge.sourceId;
    const node = graph.nodes.get(otherId);
    if (node !== undefined) {
      absorb(state, node, edge.type);
    }
  }
};

const absorb = (state: WalkState, node: GraphNode, via: string): void => {
  const key = `${node.id}|${via}`;
  if (!state.recorded.has(key)) {
    state.recorded.add(key);
    state.hops.push(hopFor(node, via));
  }
  if (!state.expanded.has(node.id)) {
    state.expanded.add(node.id);
    state.next.push(node.id);
  }
};

const walk = (
  graph: KnowledgeGraph,
  startId: string,
  direction: 'forward' | 'backward',
): FlowHop[] => {
  const state: WalkState = {
    hops: [],
    // Two separate dedupes, and the distinction matters. A node is EXPANDED once, or the walk loops.
    // But a hop is RECORDED once per relationship type: a renamed field is reached by both FLOWS_TO
    // and RENAMED_TO, and deduping by node alone silently drops whichever arrives second — which is
    // how the answer to "where is it renamed?" disappears.
    expanded: new Set([startId]),
    recorded: new Set<string>(),
    next: [],
  };
  let frontier = [startId];
  for (let depth = 0; depth < MAX_HOPS && frontier.length > 0; depth += 1) {
    state.next.length = 0;
    for (const current of frontier) {
      stepFlowEdges(graph, state, current, direction);
    }
    frontier = [...state.next];
  }
  return state.hops;
};

/**
 * Boundaries reachable from a field, over any relationship.
 *
 * Deliberately not restricted to flow edges: a field reaches a route because the DTO it belongs to is
 * returned by a handler, and that chain runs through CONTAINS and CALLS. What makes the answer honest
 * is the bound (two hops out of the field's own shape) and the explicit outcome below.
 */
const stepBoundaryEdges = (
  graph: KnowledgeGraph,
  current: string,
  seen: Set<string>,
  found: FlowHop[],
): readonly string[] => {
  const next: string[] = [];
  const edgeIds = [
    ...(graph.outgoing.get(current as NodeId) ?? []),
    ...(graph.incoming.get(current as NodeId) ?? []),
  ];
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined) {
      continue;
    }
    const otherId = edge.sourceId === current ? edge.targetId : edge.sourceId;
    const node = seen.has(otherId) ? undefined : graph.nodes.get(otherId);
    if (node === undefined) {
      continue;
    }
    seen.add(otherId);
    if (BOUNDARY_TYPES.has(node.type)) {
      found.push(hopFor(node, edge.type));
    }
    next.push(otherId);
  }
  return next;
};

const boundariesNear = (graph: KnowledgeGraph, fieldId: string): FlowHop[] => {
  const found: FlowHop[] = [];
  const seen = new Set([fieldId]);
  let frontier: readonly string[] = [fieldId];
  for (let depth = 0; depth < 3; depth += 1) {
    frontier = frontier.flatMap((current) => [...stepBoundaryEdges(graph, current, seen, found)]);
  }
  return found;
};

export const queryFieldFlow = async (
  rootDir: string,
  fieldNodeId: string,
): Promise<Failable<FieldFlowResult>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    const node = graph.nodes.get(fieldNodeId as NodeId);
    if (node === undefined) {
      return {
        ok: false,
        error: {
          category: 'configurationError' as const,
          message: `no indexed field '${fieldNodeId}' — field nodes are ids of the form field:<file>#<Shape>.<name>`,
        },
      };
    }
    const forward = walk(graph, fieldNodeId, 'forward');
    const backward = walk(graph, fieldNodeId, 'backward');
    const boundaries = boundariesNear(graph, fieldNodeId);
    return {
      ok: true,
      value: {
        field: {
          nodeId: node.id,
          name: node.name,
          path: node.path,
          nullable: isNullable(node),
        },
        flowsTo: forward,
        flowsFrom: backward,
        renames: forward.filter((hop) => hop.via === 'RENAMED_TO'),
        boundaries,
        // Detected from the code of the files the flow touches. Empty means those files state none of
        // the five patterns — not that the value travels untouched, which the outcome's limitations say.
        transformations: transformationsForPaths(rootDir, [
          ...(node.path === undefined ? [] : [node.path]),
          ...[...forward, ...backward]
            .map((hop) => hop.path)
            .filter((path): path is string => path !== undefined),
        ]),
        outcome: queryOutcome({
          scope: `field-flow edges of the indexed graph at snapshot ${current.value.snapshotId}`,
          resultCount: forward.length + backward.length,
          limitations: [
            'Field flow is resolved within a single file: a value whose consumer declares its shape in another file produces no flow edge (the indexer reports those as unsupported-syntax warnings).',
            'Only object-literal construction, DTO mapping and property reads are traced — computed keys, spreads and call results are not.',
            'Repositories not registered in this workspace were not analyzed.',
          ],
        }),
      },
    };
  });
