import { knowledgeCategoryOf } from '../provenance/provenance.js';

import { buildKnowledgeGraph } from './knowledge-graph.js';

import type { EdgeId, NodeId } from '../ids.js';
import type { EdgeType } from './edge-types.js';
import type { GraphEdge } from './graph-edge.js';
import type { GraphNode } from './graph-node.js';
import type { KnowledgeGraph } from './knowledge-graph.js';
import type { NodeCategory, NodeType } from './node-types.js';
import type { KnowledgeCategory } from '../provenance/provenance.js';

// Knowledge-category filters apply record-wide: a "facts only" query never returns or traverses
// an llm-inferred node OR edge (PRD §3, §47.10). All results are in stable id order (PRD §34).

export interface NodeFilter {
  readonly category?: NodeCategory;
  readonly type?: NodeType;
  readonly name?: string;
  readonly path?: string;
  readonly knowledgeCategories?: readonly KnowledgeCategory[];
}

export type TraversalDirection = 'outgoing' | 'incoming' | 'both';

export interface TraversalOptions {
  readonly direction: TraversalDirection;
  readonly edgeTypes?: readonly EdgeType[];
  readonly knowledgeCategories?: readonly KnowledgeCategory[];
}

export interface DependencyPath {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

const inCategories = (
  categories: readonly KnowledgeCategory[] | undefined,
  record: GraphNode | GraphEdge,
): boolean =>
  categories === undefined || categories.includes(knowledgeCategoryOf(record.knowledge.provenance));

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

const matchesFilter = (node: GraphNode, filter: NodeFilter): boolean =>
  (filter.category === undefined || node.category === filter.category) &&
  (filter.type === undefined || node.type === filter.type) &&
  (filter.name === undefined || node.name === filter.name) &&
  (filter.path === undefined || node.path === filter.path) &&
  inCategories(filter.knowledgeCategories, node);

export const findNodes = (graph: KnowledgeGraph, filter: NodeFilter): readonly GraphNode[] =>
  [...graph.nodes.values()].filter((node) => matchesFilter(node, filter)).sort(byId);

interface Step {
  readonly edge: GraphEdge;
  readonly neighborId: NodeId;
}

const stepFor = (
  graph: KnowledgeGraph,
  edgeId: EdgeId,
  nodeId: NodeId,
  options: TraversalOptions,
): Step | undefined => {
  const edge = graph.edges.get(edgeId);
  if (edge === undefined || !inCategories(options.knowledgeCategories, edge)) {
    return undefined;
  }
  if (options.edgeTypes !== undefined && !options.edgeTypes.includes(edge.type)) {
    return undefined;
  }
  const neighborId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
  const neighbor = graph.nodes.get(neighborId);
  if (neighbor === undefined || !inCategories(options.knowledgeCategories, neighbor)) {
    return undefined;
  }
  return { edge, neighborId };
};

/** Traversable steps from a node, filtered and in stable edge-id order. */
const stepsFrom = (graph: KnowledgeGraph, nodeId: NodeId, options: TraversalOptions): Step[] => {
  const edgeIds = [
    ...(options.direction !== 'incoming' ? (graph.outgoing.get(nodeId) ?? []) : []),
    ...(options.direction !== 'outgoing' ? (graph.incoming.get(nodeId) ?? []) : []),
  ].sort();
  const steps: Step[] = [];
  for (const edgeId of edgeIds) {
    const step = stepFor(graph, edgeId, nodeId, options);
    if (step !== undefined) {
      steps.push(step);
    }
  }
  return steps;
};

export const neighbors = (
  graph: KnowledgeGraph,
  nodeId: string,
  options: TraversalOptions,
): readonly GraphNode[] => {
  const unique = new Map<NodeId, GraphNode>();
  for (const step of stepsFrom(graph, nodeId as NodeId, options)) {
    const node = graph.nodes.get(step.neighborId);
    if (node !== undefined) {
      unique.set(step.neighborId, node);
    }
  }
  return [...unique.values()].sort(byId);
};

const reconstructPath = (
  graph: KnowledgeGraph,
  parents: ReadonlyMap<NodeId, Step & { readonly from: NodeId }>,
  targetId: NodeId,
): DependencyPath => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let current: NodeId | undefined = targetId;
  while (current !== undefined) {
    const node = graph.nodes.get(current);
    if (node !== undefined) {
      nodes.unshift(node);
    }
    const parent = parents.get(current);
    if (parent !== undefined) {
      edges.unshift(parent.edge);
    }
    current = parent?.from;
  }
  return { nodes, edges };
};

interface BfsState {
  readonly visited: Set<NodeId>;
  readonly parents: Map<NodeId, Step & { readonly from: NodeId }>;
}

/** Advance one BFS level; returns the next frontier. */
const advanceFrontier = (
  graph: KnowledgeGraph,
  frontier: readonly NodeId[],
  options: TraversalOptions,
  state: BfsState,
): NodeId[] => {
  const next: NodeId[] = [];
  for (const nodeId of frontier) {
    for (const step of stepsFrom(graph, nodeId, options)) {
      if (!state.visited.has(step.neighborId)) {
        state.visited.add(step.neighborId);
        state.parents.set(step.neighborId, { ...step, from: nodeId });
        next.push(step.neighborId);
      }
    }
  }
  return next;
};

/** Breadth-first shortest dependency path with edge-type and knowledge-category filters. */
export const findShortestPath = (
  graph: KnowledgeGraph,
  sourceId: string,
  targetId: string,
  options: TraversalOptions,
): DependencyPath | undefined => {
  const source = graph.nodes.get(sourceId as NodeId);
  const target = graph.nodes.get(targetId as NodeId);
  if (source === undefined || target === undefined) {
    return undefined;
  }
  const passes = (node: GraphNode): boolean => inCategories(options.knowledgeCategories, node);
  if (!passes(source) || !passes(target)) {
    return undefined;
  }
  if (source.id === target.id) {
    return { nodes: [source], edges: [] };
  }
  const state: BfsState = { visited: new Set([source.id]), parents: new Map() };
  let frontier: NodeId[] = [source.id];
  while (frontier.length > 0) {
    frontier = advanceFrontier(graph, frontier, options, state);
    if (state.parents.has(target.id)) {
      return reconstructPath(graph, state.parents, target.id);
    }
  }
  return undefined;
};

export interface SubgraphOptions extends TraversalOptions {
  readonly maxDepth?: number;
}

/** Induced subgraph around the seeds, up to maxDepth traversal steps (default unlimited). */
export const extractSubgraph = (
  graph: KnowledgeGraph,
  seedIds: readonly string[],
  options: SubgraphOptions,
): KnowledgeGraph => {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  let frontier = [...seedIds]
    .sort()
    .map((id) => graph.nodes.get(id as NodeId))
    .filter((node): node is GraphNode => node !== undefined)
    .filter((node) => inCategories(options.knowledgeCategories, node))
    .map((node) => node.id);
  const state: BfsState = { visited: new Set(frontier), parents: new Map() };
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    frontier = advanceFrontier(graph, frontier, options, state);
  }
  const included = state.visited;
  const nodes = [...included]
    .map((id) => graph.nodes.get(id))
    .filter((node): node is GraphNode => node !== undefined)
    .sort(byId);
  const edges = [...graph.edges.values()]
    .filter(
      (edge) =>
        included.has(edge.sourceId) &&
        included.has(edge.targetId) &&
        inCategories(options.knowledgeCategories, edge) &&
        (options.edgeTypes === undefined || options.edgeTypes.includes(edge.type)),
    )
    .sort(byId);
  return buildKnowledgeGraph(nodes, edges);
};
