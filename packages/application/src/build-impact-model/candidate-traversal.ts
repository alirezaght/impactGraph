import {
  isChainEdge,
  isOwnershipFamilyEdge,
  isTraversableEdge,
  isWeakWhenReversed,
  NEVER_STRONG,
  roleOf,
} from './traversal-edge-semantics.js';

import type { ConceptMatch, MatchMechanism } from './concept-matching.js';
import type { GraphEdge, KnowledgeGraph, NodeId } from '@impactgraph/domain';

// Story 6.2 — bounded, deterministic candidate traversal. Candidates come from typed-edge walks
// starting at matched nodes; the model (later) only classifies this bounded set (§43.5).
//
// Discovery is deliberately UNCAPPED within maxDepth. An output cap applied mid-walk decides which
// components a user is told about by traversal order — which edge record sorted first, which
// concept sorted first — and none of that carries architectural meaning. Ranking and truncation
// belong after scoring; see the cap in build-impact-model.ts. `maxExpansions` here is a runaway
// guard on work done, not a statement about how many results are interesting.

export interface ImpactCandidate {
  readonly nodeId: string;
  readonly distance: number;
  /** Node ids from the matched node to this candidate, inclusive (§13.1 dependencyPath). */
  readonly dependencyPath: readonly string[];
  /** Edge types along `dependencyPath` — the route that explains this candidate. */
  readonly edgeTypes: readonly string[];
  /**
   * Distinct edge types across EVERY route that reached this candidate, `edgeTypes` included.
   * Two independent relationships are stronger evidence than one, so scoring reads this; the
   * explanation still quotes the single route in `edgeTypes`. Distinct by type, so three import
   * paths do not compound into three import signals.
   */
  readonly corroboratingEdgeTypes: readonly string[];
  /**
   * True when at least one route to this candidate is a legitimate propagation shape. Judged per
   * ROUTE rather than from the merged evidence, because the two edges of a single chain are one
   * piece of evidence and not two.
   */
  readonly admissible: boolean;
  /**
   * True when EVERY route here is a single weak hop: a reverse dependency edge, or an edge whose
   * meaning is unknown. Structural coupling with no corroboration. Classification reads this to keep
   * such candidates at `possible` rather than presenting mere connectedness as likely change.
   */
  readonly weakLinkOnly: boolean;
  readonly edgeEvidenceIds: readonly string[];
  /**
   * Hops taken over ordinary structural edges. This — not `distance` — is what the depth budget
   * bounds, so an event chain can be followed to its end without also widening every import walk.
   */
  readonly structuralDepth: number;
  /** Hops taken over chain edges (async, contract, field-flow). Bounded by `maxChainHops`. */
  readonly chainHops: number;
  /**
   * Distinct concepts across EVERY route that reached this candidate — including routes longer
   * than the kept one, which contribute corroboration metadata but never evidence. Two concepts of
   * one requirement independently arriving at a node is what separates "the requirement is about
   * this component" from "this component shares a name with the requirement" (collision guard).
   */
  readonly anchorConcepts: readonly string[];
  /**
   * True when a route starting at a DIFFERENT anchor node reached this candidate over at least one
   * propagating edge. A walk out of a node and back to it re-observes its own edges and proves
   * nothing, so self-rooted routes never set this.
   */
  readonly propagationCorroborated: boolean;
  readonly match: ConceptMatch;
}

export interface TraversalOptions {
  readonly maxDepth?: number;
  /**
   * How many chain edges a route may cross. 8 covers the longest real chain observed — producer →
   * outbox record → relay → topic → Terraform topic → subscription → push endpoint → route →
   * projection → renderer → locale key — with a hop to spare.
   */
  readonly maxChainHops?: number;
  /** Runaway guard on expansion work. Distinct from the output cap below. */
  readonly maxExpansions?: number;
  /**
   * Output-size limit. Deliberately NOT honoured here: traversal returns everything within
   * maxDepth and build-impact-model truncates after scoring, so the limit selects the strongest
   * candidates instead of the first-discovered ones.
   */
  readonly maxCandidates?: number;
}

export interface TraversalResult {
  readonly candidates: readonly ImpactCandidate[];
  /** True when `maxExpansions` stopped the walk — a safety trip, not a filtered result. */
  readonly exhausted: boolean;
  /** Candidates refused admission because every route to them left the anchor's own container. */
  readonly ownershipOnly: readonly string[];
}

/**
 * Ownership carries impact to the container and to the container's DEPENDENTS, not to the
 * container's own dependencies.
 *
 * Reaching the file that declares an anchored symbol is useful — the file is where the change
 * lands — and so is reaching whatever imports that file, which is the §46 promise to surface
 * dependents the specification never named. What is not evidence is the third shape:
 * `anchor —CONTAINS↑→ its file —imports→ something the file depends on`. That inverts the
 * direction of impact and changes the subject from "affected by this symbol" to "anything this
 * symbol's file happens to use", which is how co-located base classes and sibling contracts arrive.
 */
const routeAdmissible = (from: ImpactCandidate, step: Step): boolean => {
  const firstEdge = from.edgeTypes[0];
  if (firstEdge === undefined || roleOf(firstEdge) !== 'ownership') {
    return true;
  }
  return step.towardDependents;
};

interface Step {
  readonly edge: GraphEdge;
  readonly neighborId: NodeId;
  /**
   * True when the step moved toward things that DEPEND on the node we came from, rather than toward
   * that node's own dependencies. Impact flows to dependents, so the direction decides whether a
   * second hop out of a container is propagation or merely the container's own imports.
   */
  readonly towardDependents: boolean;
}

const stepFor = (edge: GraphEdge, nodeId: NodeId): Step | undefined => {
  if (!isTraversableEdge(edge.type)) {
    return undefined;
  }
  if (isOwnershipFamilyEdge(edge.type)) {
    return edge.sourceId === nodeId
      ? undefined
      : { edge, neighborId: edge.sourceId, towardDependents: true };
  }
  return {
    edge,
    neighborId: edge.sourceId === nodeId ? edge.targetId : edge.sourceId,
    towardDependents: edge.targetId === nodeId,
  };
};

const stepsFrom = (graph: KnowledgeGraph, nodeId: NodeId): Step[] => {
  const edgeIds = [...(graph.outgoing.get(nodeId) ?? []), ...(graph.incoming.get(nodeId) ?? [])];
  return edgeIds
    .map((edgeId) => graph.edges.get(edgeId))
    .filter((edge): edge is GraphEdge => edge !== undefined)
    .map((edge) => stepFor(edge, nodeId))
    .filter((step): step is Step => step !== undefined);
};

const MECHANISM_STRENGTH: Readonly<Record<MatchMechanism, number>> = {
  exact: 2,
  alias: 2,
  'path-suffix': 2,
  basename: 1,
  'name-similarity': 1,
  'path-segment': 1,
  // Conceptual mechanisms rank below identifier matching: when two routes reach the same component
  // and one is anchored by a name the specification wrote, that route explains the component.
  semantic: 1,
  lexical: 0,
};

/**
 * Route dominance. A route replaces another only when it is unambiguously better: closer first,
 * then anchored by a stronger match, then carrying more distinct relationships. The final
 * tie-break is the path's own node ids — never edge ids, so renaming an edge record cannot change
 * which route explains a component.
 */
const isBetterRoute = (incoming: ImpactCandidate, existing: ImpactCandidate): boolean => {
  if (incoming.distance !== existing.distance) {
    return incoming.distance < existing.distance;
  }
  const incomingStrength = MECHANISM_STRENGTH[incoming.match.mechanism];
  const existingStrength = MECHANISM_STRENGTH[existing.match.mechanism];
  if (incomingStrength !== existingStrength) {
    return incomingStrength > existingStrength;
  }
  if (incoming.edgeTypes.length !== existing.edgeTypes.length) {
    return incoming.edgeTypes.length > existing.edgeTypes.length;
  }
  return incoming.dependencyPath.join('>') < existing.dependencyPath.join('>');
};

const union = (left: readonly string[], right: readonly string[]): string[] =>
  [...new Set([...left, ...right])].sort();

interface TraversalState {
  readonly best: Map<string, ImpactCandidate>;
  readonly maxExpansions: number;
  expansions: number;
  exhausted: boolean;
}

/** A route corroborates a node structurally only when it starts elsewhere and truly propagates. */
const propagatesFromElsewhere = (route: ImpactCandidate): boolean =>
  route.dependencyPath[0] !== route.nodeId &&
  route.edgeTypes.some((type) => roleOf(type) === 'propagating');

/**
 * Keeps the dominant route and corroborates it with EQUALLY SHORT alternatives only.
 *
 * A longer route to a component already reached more directly is not extra evidence — walking out
 * from a node and back to it re-observes the same edge, which would let an anchor absorb signals
 * from its own dependents and score above an exact match. Only genuinely alternative shortest
 * routes represent independent relationships.
 *
 * Longer routes DO leave one trace: the corroboration metadata (`anchorConcepts`,
 * `propagationCorroborated`). It answers the collision guard's yes/no question — did anything else
 * arrive here independently? — and never feeds edge-type evidence, scoring, or route choice.
 */
const mergeCandidate = (state: TraversalState, incoming: ImpactCandidate): void => {
  const existing = state.best.get(incoming.nodeId);
  if (existing === undefined) {
    state.best.set(incoming.nodeId, incoming);
    return;
  }
  const anchorConcepts = union(existing.anchorConcepts, incoming.anchorConcepts);
  const propagationCorroborated =
    existing.propagationCorroborated ||
    incoming.propagationCorroborated ||
    propagatesFromElsewhere(existing) ||
    propagatesFromElsewhere(incoming);
  if (incoming.distance > existing.distance) {
    state.best.set(incoming.nodeId, { ...existing, anchorConcepts, propagationCorroborated });
    return;
  }
  if (incoming.distance < existing.distance) {
    state.best.set(incoming.nodeId, { ...incoming, anchorConcepts, propagationCorroborated });
    return;
  }
  const winner = isBetterRoute(incoming, existing) ? incoming : existing;
  state.best.set(incoming.nodeId, {
    ...winner,
    corroboratingEdgeTypes: union(existing.corroboratingEdgeTypes, incoming.corroboratingEdgeTypes),
    // OR, not AND: one legitimate route is enough to admit the candidate.
    admissible: existing.admissible || incoming.admissible,
    // AND: any route that is more than a bare weak hop corroborates the candidate. An unknown
    // relationship never supplies that, so two unknowns stay two unknowns.
    weakLinkOnly: existing.weakLinkOnly && incoming.weakLinkOnly,
    edgeEvidenceIds: union(existing.edgeEvidenceIds, incoming.edgeEvidenceIds),
    anchorConcepts,
    propagationCorroborated,
  });
};

const traverseFromMatch = (
  graph: KnowledgeGraph,
  match: ConceptMatch,
  budgets: { maxDepth: number; maxChainHops: number },
  state: TraversalState,
): void => {
  const { maxDepth, maxChainHops } = budgets;
  const seed: ImpactCandidate = {
    nodeId: match.nodeId,
    distance: 0,
    dependencyPath: [match.nodeId],
    edgeTypes: [],
    corroboratingEdgeTypes: [],
    admissible: true,
    weakLinkOnly: false,
    edgeEvidenceIds: [],
    structuralDepth: 0,
    chainHops: 0,
    anchorConcepts: [match.concept],
    propagationCorroborated: false,
    match,
  };
  mergeCandidate(state, seed);
  // Expanded once per anchor at its shortest distance: BFS by level means the first arrival is
  // the closest, and every later arrival still merges its evidence without re-expanding.
  const walk: AnchorWalk = { graph, state, expanded: new Set([match.nodeId]), next: [] };
  let frontier: ImpactCandidate[] = [seed];
  // The loop bound is the SUM of both budgets: a level may spend either, and a chain-only route needs
  // as many levels as it has hops. Each candidate still refuses the step that would exceed its own
  // budget, so the extra levels can only be spent on chain edges.
  for (let level = 0; level < maxDepth + maxChainHops; level += 1) {
    walk.next = [];
    for (const current of frontier) {
      if (!expandOne(walk, current, match, { maxDepth, maxChainHops })) {
        return;
      }
    }
    frontier = walk.next;
    if (frontier.length === 0) {
      return;
    }
  }
};

const stepCandidate = (
  current: ImpactCandidate,
  step: Step,
  match: ConceptMatch,
): ImpactCandidate => {
  const edgeTypes = [...current.edgeTypes, step.edge.type];
  const chain = isChainEdge(step.edge.type);
  return {
    nodeId: step.neighborId,
    distance: current.distance + 1,
    dependencyPath: [...current.dependencyPath, step.neighborId],
    edgeTypes,
    corroboratingEdgeTypes: [...new Set(edgeTypes)].sort(),
    admissible: current.admissible && routeAdmissible(current, step),
    weakLinkOnly:
      current.distance === 0 &&
      (step.edge.type === NEVER_STRONG ||
        (step.towardDependents && isWeakWhenReversed(step.edge.type))),
    edgeEvidenceIds: [...current.edgeEvidenceIds, ...step.edge.knowledge.evidenceIds],
    // Crossing a chain edge RESETS the structural budget. Rationale: the budget answers "how far
    // through a local neighbourhood may a walk wander", and a service boundary starts a new
    // neighbourhood. Two structural hops on the far side of a topic is the same rule as two on this
    // side — not an extension of it. Growth stays bounded because chain hops are capped, and each one
    // opens at most `maxDepth` structural hops rather than an unbounded walk.
    structuralDepth: chain ? 0 : current.structuralDepth + 1,
    chainHops: current.chainHops + (chain ? 1 : 0),
    // Route-level values: corroboration is a property of MERGING routes, established there.
    anchorConcepts: [match.concept],
    propagationCorroborated: false,
    match,
  };
};

/** One anchor's walk: the shared graph and budget, plus the per-anchor expansion bookkeeping. */
interface AnchorWalk {
  readonly graph: KnowledgeGraph;
  readonly state: TraversalState;
  /** Nodes already expanded for this anchor, so a component is walked out of only once. */
  readonly expanded: Set<string>;
  next: ImpactCandidate[];
}

/** Returns false when the safety budget is spent and the walk must stop. */
const expandOne = (
  walk: AnchorWalk,
  current: ImpactCandidate,
  match: ConceptMatch,
  budgets: { maxDepth: number; maxChainHops: number },
): boolean => {
  for (const step of stepsFrom(walk.graph, current.nodeId as NodeId)) {
    walk.state.expansions += 1;
    if (walk.state.expansions > walk.state.maxExpansions) {
      walk.state.exhausted = true;
      return false;
    }
    const candidate = stepCandidate(current, step, match);
    if (
      candidate.structuralDepth > budgets.maxDepth ||
      candidate.chainHops > budgets.maxChainHops
    ) {
      continue;
    }
    mergeCandidate(walk.state, candidate);
    if (!walk.expanded.has(step.neighborId)) {
      walk.expanded.add(step.neighborId);
      walk.next.push(candidate);
    }
  }
  return true;
};

/**
 * Deterministic: identical graph + matches → identical candidates, and permuting edge ids or the
 * order of `matches` cannot change the result (§43.5). Every reachable candidate within maxDepth
 * is returned; the caller ranks and truncates.
 */
export const traverseCandidates = (
  graph: KnowledgeGraph,
  matches: readonly ConceptMatch[],
  options: TraversalOptions = {},
): TraversalResult => {
  const state: TraversalState = {
    best: new Map(),
    maxExpansions: options.maxExpansions ?? 20_000,
    expansions: 0,
    exhausted: false,
  };
  const budgets = {
    maxDepth: options.maxDepth ?? 2,
    maxChainHops: options.maxChainHops ?? 8,
  };
  for (const match of matches) {
    if (graph.nodes.has(match.nodeId as NodeId)) {
      traverseFromMatch(graph, match, budgets, state);
    }
  }
  const discovered = [...state.best.values()].sort(
    (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
  );
  return {
    candidates: discovered.filter((candidate) => candidate.admissible),
    exhausted: state.exhausted,
    ownershipOnly: discovered
      .filter((candidate) => !candidate.admissible)
      .map((candidate) => candidate.nodeId),
  };
};
