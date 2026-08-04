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
  // §12.2.1 relationship split. Traversable exactly as USES was, so the vocabulary migration is
  // behaviour-neutral; propagation rules per type come afterwards, deliberately.
  'INJECTS',
  'NAVIGATES_TO',
  'SUBMITS_TO',
  'CALLS_ENDPOINT',
  'USES_MIDDLEWARE',
  'REFERENCES_RESOURCE',
  'BINDS',
  'USES_UNKNOWN',
  'CONTAINS',
  // Async / service-boundary chain (item 5). Without these the walk stops at the first async hop,
  // which is exactly why outbox → Pub/Sub → push route → projection was invisible: every link in
  // that chain is a relationship the traversal roster did not contain.
  'RECORDED_IN',
  'RELAYS_TO',
  'DELIVERS_TO',
  'PROJECTS_TO',
  'TRIGGERS',
  // Contract and asset relationships (items 6, 8).
  'SPECIFIED_BY',
  'IMPLEMENTS_OPERATION',
  'DEFINES_KEY',
  'RENDERS_KEY',
  'CONFIGURES',
  // Field-level flow (item 7).
  'FLOWS_TO',
  'RENAMED_TO',
  'SERIALIZED_AS',
]);

/**
 * What crossing an edge means for impact propagation.
 *
 * propagating — the target genuinely depends on the source, so change flows across it.
 * ownership   — the target merely CONTAINS or declares the source. Useful for locating a symbol,
 *               rolling an impact up to its file, and explaining where an anchor lives; it is not
 *               evidence that the file's other declarations are affected.
 * supporting  — a real relationship of a weaker kind (tests, deployment) that may still carry
 *               impact but does not assert dependency.
 */
export type TraversalRole = 'propagating' | 'ownership' | 'supporting';

const EDGE_ROLES: Readonly<Record<string, TraversalRole>> = {
  IMPORTS: 'propagating',
  CALLS: 'propagating',
  EXTENDS: 'propagating',
  IMPLEMENTS: 'propagating',
  READS_FROM: 'propagating',
  WRITES_TO: 'propagating',
  PUBLISHES: 'propagating',
  SUBSCRIBES_TO: 'propagating',
  DEPENDS_ON: 'propagating',
  EXPOSES: 'propagating',
  CONTAINS: 'ownership',
  TESTS: 'supporting',
  DEPLOYED_AS: 'supporting',
  USES: 'supporting',
  INJECTS: 'supporting',
  NAVIGATES_TO: 'supporting',
  SUBMITS_TO: 'supporting',
  CALLS_ENDPOINT: 'supporting',
  USES_MIDDLEWARE: 'supporting',
  REFERENCES_RESOURCE: 'supporting',
  BINDS: 'supporting',
  USES_UNKNOWN: 'supporting',
  // Every hop of an event chain is genuine propagation: a change to what a producer records reaches
  // the relay, the topic, the endpoint it is delivered to, and the projection built from it. That is
  // the same kind of obligation a contract change carries, not a weaker "related to" association.
  RECORDED_IN: 'propagating',
  RELAYS_TO: 'propagating',
  DELIVERS_TO: 'propagating',
  PROJECTS_TO: 'propagating',
  TRIGGERS: 'propagating',
  // A declared contract is the other side of an implementation: changing one obliges the other.
  SPECIFIED_BY: 'propagating',
  IMPLEMENTS_OPERATION: 'propagating',
  RENDERS_KEY: 'propagating',
  FLOWS_TO: 'propagating',
  RENAMED_TO: 'propagating',
  SERIALIZED_AS: 'propagating',
  // A bundle DECLARING a key is ownership, like a file containing a symbol: reaching the bundle
  // from the key is useful, reaching the bundle's other 400 keys is not.
  DEFINES_KEY: 'ownership',
  CONFIGURES: 'supporting',
};

export const roleOf = (edgeType: string): TraversalRole => EDGE_ROLES[edgeType] ?? 'supporting';

/**
 * Edges whose REVERSE traversal proves structural connection and nothing more.
 *
 * Walking from a callee to its caller, or from a module to something that imports it, says the
 * neighbour is coupled to the anchor — not that it must change. Adding a method to a class obliges
 * no existing caller and no factory to change, so a single reverse hop across one of these may not
 * on its own produce a `likely` impact.
 *
 * DEPENDS_ON is deliberately absent: a manifest declaring a dependency is a far more direct
 * statement than a call, and the package declaring a native binding is exactly where a packaging
 * requirement lands. EXTENDS, IMPLEMENTS and the event edges are absent because they are contract
 * relationships, where a change genuinely does propagate to the other side.
 */
const WEAK_WHEN_REVERSED = new Set([
  'CALLS',
  'IMPORTS',
  'USES',
  'INJECTS',
  'NAVIGATES_TO',
  'SUBMITS_TO',
  'CALLS_ENDPOINT',
  'USES_MIDDLEWARE',
  'REFERENCES_RESOURCE',
  'BINDS',
]);

/**
 * An unclassified relationship is weak in BOTH directions (§12.2.1). Reversing it is not what makes
 * it weak — not knowing what it means is, so it can never reach `likely` however it is walked, and
 * it never corroborates another route.
 */
const NEVER_STRONG = 'USES_UNKNOWN';

/**
 * Relationships that do not consume the ordinary depth budget (item 5).
 *
 * An event chain is long by construction — producer → outbox row → relay → topic → subscription →
 * push endpoint → projection → renderer → locale key is eight hops — and every one of those hops is a
 * contract obligation, not a coincidence of proximity. With `maxDepth: 2` the walk stopped at the
 * second hop, which is exactly why "outbox → Pub/Sub → push route → projection was invisible".
 *
 * Raising `maxDepth` for everything is not the fix: two hops of ordinary imports and calls already
 * reaches most of a package, and three reaches most of a repository. So these edge types get their
 * OWN budget instead: crossing one costs a chain hop, not a depth hop, and `maxChainHops` bounds the
 * chain. The tier still falls with total distance, so a component eight hops away is `possible`, not
 * `required` — the chain is made VISIBLE, not made confident.
 */
const CHAIN_EDGE_TYPES = new Set([
  'RECORDED_IN',
  'RELAYS_TO',
  'DELIVERS_TO',
  'PROJECTS_TO',
  'PUBLISHES',
  'SUBSCRIBES_TO',
  'TRIGGERS',
  'DEPLOYED_AS',
  'EXPOSES',
  'SPECIFIED_BY',
  'IMPLEMENTS_OPERATION',
  'RENDERS_KEY',
  'FLOWS_TO',
  'RENAMED_TO',
  'SERIALIZED_AS',
]);

export const isChainEdge = (edgeType: string): boolean => CHAIN_EDGE_TYPES.has(edgeType);

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

/**
 * CONTAINS is only walked upward (contained → container) to avoid sibling explosion.
 *
 * DEPENDS_ON is likewise walked in one direction only, from the depended-upon node to the node
 * that depends on it. Impact propagates to dependents: if better-sqlite3 changes, the packages
 * declaring it are affected — but naming a package must not make an impact out of every library
 * it declares, nor out of its dependencies' dependencies.
 */
/**
 * Declaration edges: walked UPWARD only, from the declared thing to whatever declares it. A locale
 * bundle DEFINES_KEY joins the family for the same reason CONTAINS is in it — reaching the bundle
 * from one key is useful; reaching the bundle's other 400 keys is sibling explosion.
 */
const UPWARD_ONLY = new Set(['CONTAINS', 'DEPENDS_ON', 'DEFINES_KEY']);

const stepFor = (edge: GraphEdge, nodeId: NodeId): Step | undefined => {
  if (!IMPACT_EDGE_TYPES.has(edge.type)) {
    return undefined;
  }
  if (UPWARD_ONLY.has(edge.type)) {
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
  'name-similarity': 1,
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

/**
 * Keeps the dominant route and corroborates it with EQUALLY SHORT alternatives only.
 *
 * A longer route to a component already reached more directly is not extra evidence — walking out
 * from a node and back to it re-observes the same edge, which would let an anchor absorb signals
 * from its own dependents and score above an exact match. Only genuinely alternative shortest
 * routes represent independent relationships.
 */
const mergeCandidate = (state: TraversalState, incoming: ImpactCandidate): void => {
  const existing = state.best.get(incoming.nodeId);
  if (existing === undefined) {
    state.best.set(incoming.nodeId, incoming);
    return;
  }
  if (incoming.distance > existing.distance) {
    return;
  }
  if (incoming.distance < existing.distance) {
    state.best.set(incoming.nodeId, incoming);
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
        (step.towardDependents && WEAK_WHEN_REVERSED.has(step.edge.type))),
    edgeEvidenceIds: [...current.edgeEvidenceIds, ...step.edge.knowledge.evidenceIds],
    // Crossing a chain edge RESETS the structural budget. Rationale: the budget answers "how far
    // through a local neighbourhood may a walk wander", and a service boundary starts a new
    // neighbourhood. Two structural hops on the far side of a topic is the same rule as two on this
    // side — not an extension of it. Growth stays bounded because chain hops are capped, and each one
    // opens at most `maxDepth` structural hops rather than an unbounded walk.
    structuralDepth: chain ? 0 : current.structuralDepth + 1,
    chainHops: current.chainHops + (chain ? 1 : 0),
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
