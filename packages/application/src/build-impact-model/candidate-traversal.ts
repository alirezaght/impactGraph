import type { ConceptMatch } from './concept-matching.js';
import type { GraphEdge, KnowledgeGraph, NodeId } from '@impactgraph/domain';

// Story 6.2 — bounded, deterministic candidate traversal. Candidates come from typed-edge
// walks starting at matched nodes; the model (later) only classifies this bounded set (§43.5).

const IMPACT_EDGE_TYPES = new Set([
  'IMPORTS',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
  'READS_FROM',
  'WRITES_TO',
  'PUBLISHES',
  'SUBSCRIBES_TO',
  'TESTS',
  'DEPLOYED_AS',
  // A handler EXPOSES its route, and a caller USES that route. Without EXPOSES the chain breaks
  // at the first hop: a specification naming `list_deals` reaches the handler symbol but never
  // the route node, and therefore never the front-end caller on the other side of it — the
  // cross-stack correspondence would exist in the graph and be invisible to impact analysis.
  'EXPOSES',
  'DEPENDS_ON',
  'USES',
  'CONTAINS',
]);

export interface ImpactCandidate {
  readonly nodeId: string;
  readonly distance: number;
  /** Node ids from the matched node to this candidate, inclusive (§13.1 dependencyPath). */
  readonly dependencyPath: readonly string[];
  readonly edgeTypes: readonly string[];
  readonly edgeEvidenceIds: readonly string[];
  readonly match: ConceptMatch;
}

export interface TraversalOptions {
  readonly maxDepth?: number;
  readonly maxCandidates?: number;
}

export interface TraversalResult {
  readonly candidates: readonly ImpactCandidate[];
  readonly cutoff: boolean;
}

interface Step {
  readonly edge: GraphEdge;
  readonly neighborId: NodeId;
}

/**
 * CONTAINS is only walked upward (contained → container) to avoid sibling explosion.
 *
 * DEPENDS_ON is likewise walked in one direction only, from the depended-upon node to the node
 * that depends on it. Impact propagates to dependents: if better-sqlite3 changes, the packages
 * declaring it are affected — but naming a package must not make an impact out of every library
 * it declares, nor out of its dependencies' dependencies. Walking both ways turned one matched
 * dependency into an impact on most of the monorepo.
 */
const stepsFrom = (graph: KnowledgeGraph, nodeId: NodeId): Step[] => {
  const steps: Step[] = [];
  const edgeIds = [
    ...(graph.outgoing.get(nodeId) ?? []),
    ...(graph.incoming.get(nodeId) ?? []),
  ].sort();
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || !IMPACT_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    if (edge.type === 'CONTAINS' || edge.type === 'DEPENDS_ON') {
      if (edge.sourceId !== nodeId) {
        // upward: to the container, or to the node that declares this dependency
        steps.push({ edge, neighborId: edge.sourceId });
      }
      continue;
    }
    steps.push({ edge, neighborId: edge.sourceId === nodeId ? edge.targetId : edge.sourceId });
  }
  return steps;
};

interface TraversalState {
  readonly best: Map<string, ImpactCandidate>;
  readonly visited: Set<string>;
  readonly maxCandidates: number;
  cutoff: boolean;
}

const recordBest = (best: Map<string, ImpactCandidate>, candidate: ImpactCandidate): void => {
  const existing = best.get(candidate.nodeId);
  if (
    existing === undefined ||
    candidate.distance < existing.distance ||
    (candidate.distance === existing.distance && candidate.match.mechanism === 'exact')
  ) {
    best.set(candidate.nodeId, candidate);
  }
};

const expand = (
  graph: KnowledgeGraph,
  current: ImpactCandidate,
  state: TraversalState,
): ImpactCandidate[] => {
  const discovered: ImpactCandidate[] = [];
  for (const step of stepsFrom(graph, current.nodeId as NodeId)) {
    if (state.visited.has(step.neighborId)) {
      continue;
    }
    state.visited.add(step.neighborId);
    if (state.best.size >= state.maxCandidates) {
      state.cutoff = true;
      continue;
    }
    const candidate: ImpactCandidate = {
      nodeId: step.neighborId,
      distance: current.distance + 1,
      dependencyPath: [...current.dependencyPath, step.neighborId],
      edgeTypes: [...current.edgeTypes, step.edge.type],
      edgeEvidenceIds: [...current.edgeEvidenceIds, ...step.edge.knowledge.evidenceIds],
      match: current.match,
    };
    recordBest(state.best, candidate);
    discovered.push(candidate);
  }
  return discovered;
};

const traverseFromMatch = (
  graph: KnowledgeGraph,
  match: ConceptMatch,
  maxDepth: number,
  state: TraversalState,
): void => {
  state.visited.clear();
  state.visited.add(match.nodeId);
  const seed: ImpactCandidate = {
    nodeId: match.nodeId,
    distance: 0,
    dependencyPath: [match.nodeId],
    edgeTypes: [],
    edgeEvidenceIds: [],
    match,
  };
  let frontier: ImpactCandidate[] = [seed];
  recordBest(state.best, seed);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    frontier = frontier.flatMap((current) => expand(graph, current, state));
  }
};

/** Deterministic BFS: identical graph + matches → identical candidates (§43.5). */
export const traverseCandidates = (
  graph: KnowledgeGraph,
  matches: readonly ConceptMatch[],
  options: TraversalOptions = {},
): TraversalResult => {
  const state: TraversalState = {
    best: new Map(),
    visited: new Set(),
    maxCandidates: options.maxCandidates ?? 100,
    cutoff: false,
  };
  for (const match of matches) {
    if (graph.nodes.has(match.nodeId as NodeId)) {
      traverseFromMatch(graph, match, options.maxDepth ?? 2, state);
    }
  }
  const candidates = [...state.best.values()].sort(
    (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
  );
  return { candidates, cutoff: state.cutoff };
};
