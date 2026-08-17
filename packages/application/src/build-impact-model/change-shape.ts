/**
 * How far a change reaches, judged before the walk (ADR-0023).
 *
 * Not every specification deserves the same depth. A change contained inside one package, touching
 * no queue, contract or deployment surface, is exhaustively traceable by reading the code — the
 * eight-chain-hop walk that a cross-service event chain needs spends the developer's attention
 * (and the reader's) for nothing. A distributed change is where the graph earns its keep.
 *
 * Judged from the anchors concept matching has already produced, plus their own incident edges:
 * no extra traversal, no second pass. Being wrong is cheap in one direction and not the other, so
 * the rule is conservative — anything touching async, contract or infrastructure surface, taking
 * part in a chain, or spanning more than one top-level container is treated as distributed.
 */

import { containerOf, containerRoots } from './top-level-container.js';
import { isChainEdge } from './traversal-edge-semantics.js';

import type { ConceptMatch } from './concept-matching.js';
import type { TraversalOptions } from './candidate-traversal.js';
import type { GraphNode, KnowledgeGraph, NodeId } from '@impactgraph/domain';

export const CHANGE_SHAPES = ['contained', 'distributed'] as const;
export type ChangeShape = (typeof CHANGE_SHAPES)[number];

export interface ChangeShapeAssessment {
  readonly shape: ChangeShape;
  /** Why, in one clause, so the depth decision is auditable rather than mysterious. */
  readonly reason: string;
  /** Top-level containers (packages/services) the anchors fall in. */
  readonly containerCount: number;
}

/**
 * Node types whose presence means the change reaches beyond code a reader can follow by hand:
 * queues and topics hide their consumers, contracts hide their clients, infrastructure hides
 * what actually serves traffic. These are precisely the cases the graph exists for.
 */
const FAR_REACHING_TYPES = new Set([
  'topic',
  'queue',
  'subscription',
  'event',
  'message-broker',
  'external-api',
  'contract',
  'openapi-document',
  'proto-service',
  'route',
  'terraform-resource',
  'terraform-module',
  'terraform-local',
  'terraform-output',
  'terraform-variable',
  'cloud-run-service',
  'cloud-run-job',
  'service-url',
  'environment-variable',
  'configuration-file',
  'database',
  'table',
]);

/** Whether any edge into or out of this node is a chain edge — the shape of hidden reach. */
const hasIncidentChainEdge = (graph: KnowledgeGraph, nodeId: string): boolean => {
  const edgeIds = [
    ...(graph.outgoing.get(nodeId as NodeId) ?? []),
    ...(graph.incoming.get(nodeId as NodeId) ?? []),
  ];
  return edgeIds.some((edgeId) => {
    const edge = graph.edges.get(edgeId);
    return edge !== undefined && isChainEdge(edge.type);
  });
};

const anchorNodes = (graph: KnowledgeGraph, matches: readonly ConceptMatch[]): GraphNode[] => {
  const nodes: GraphNode[] = [];
  for (const match of matches) {
    const node = graph.nodes.get(match.nodeId as NodeId);
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  return nodes;
};

export const assessChangeShape = (
  graph: KnowledgeGraph,
  matches: readonly ConceptMatch[],
): ChangeShapeAssessment => {
  const anchors = anchorNodes(graph, matches);
  if (anchors.length === 0) {
    // Nothing resolved: there is no evidence of containment, so claim none.
    return { shape: 'distributed', reason: 'no anchor resolved', containerCount: 0 };
  }
  const farReaching = anchors.find((node) => FAR_REACHING_TYPES.has(node.type));
  if (farReaching !== undefined) {
    return {
      shape: 'distributed',
      reason: `the change touches ${farReaching.name} (${farReaching.type}), whose consumers are not visible in the code that changes`,
      containerCount: 0,
    };
  }
  // An anchor that merely PUBLISHES to a topic looks local in isolation. Judging only the anchors
  // would call such a change contained and then decline to follow the very chain that makes it
  // dangerous, so the anchors' own edges are inspected too — one hop, no walk.
  const chained = anchors.find((node) => hasIncidentChainEdge(graph, node.id));
  if (chained !== undefined) {
    return {
      shape: 'distributed',
      reason: `${chained.name} takes part in an asynchronous or deployment chain whose far end is not visible in the code that changes`,
      containerCount: 0,
    };
  }
  const roots = containerRoots(graph);
  const containers = new Set(anchors.map((node) => containerOf(node, roots) ?? '(unattributed)'));
  if (containers.size > 1) {
    return {
      shape: 'distributed',
      reason: `the change spans ${String(containers.size)} top-level components`,
      containerCount: containers.size,
    };
  }
  return {
    shape: 'contained',
    reason: `every resolved surface lives in one component${containers.size === 1 ? ` (${[...containers][0] ?? ''})` : ''}, and none of them is a queue, contract or deployment surface`,
    containerCount: containers.size,
  };
};

/**
 * The walk a shape deserves. A contained change keeps the full structural depth — direct callers
 * still matter — but stops chaining through the long asynchronous routes that only exist in
 * distributed systems, and walks a budget an order of magnitude smaller.
 */
export const traversalFor = (shape: ChangeShape): TraversalOptions =>
  shape === 'contained' ? { maxChainHops: 1, maxExpansions: 2_000 } : {};
