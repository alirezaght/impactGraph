// Story 6.2 — what each relationship type MEANS for impact traversal, separated from the walk
// itself (candidate-traversal.ts): the roster of traversable types, the propagation role each one
// carries, which are weak when reversed, which spend the chain budget, and which are walked
// upward only. Pure vocabulary — no graph access, no state.

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

export const isTraversableEdge = (edgeType: string): boolean => IMPACT_EDGE_TYPES.has(edgeType);

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

export const isWeakWhenReversed = (edgeType: string): boolean => WEAK_WHEN_REVERSED.has(edgeType);

/**
 * An unclassified relationship is weak in BOTH directions (§12.2.1). Reversing it is not what makes
 * it weak — not knowing what it means is, so it can never reach `likely` however it is walked, and
 * it never corroborates another route.
 */
export const NEVER_STRONG = 'USES_UNKNOWN';

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

/**
 * CONTAINS is only walked upward (contained → container) to avoid sibling explosion.
 *
 * DEPENDS_ON is likewise walked in one direction only, from the depended-upon node to the node
 * that depends on it. Impact propagates to dependents: if better-sqlite3 changes, the packages
 * declaring it are affected — but naming a package must not make an impact out of every library
 * it declares, nor out of its dependencies' dependencies.
 *
 * Declaration edges: walked UPWARD only, from the declared thing to whatever declares it. A locale
 * bundle DEFINES_KEY joins the family for the same reason CONTAINS is in it — reaching the bundle
 * from one key is useful; reaching the bundle's other 400 keys is sibling explosion.
 */
const UPWARD_ONLY = new Set(['CONTAINS', 'DEPENDS_ON', 'DEFINES_KEY']);

/**
 * Whether an edge belongs to the ownership/declaration family above. Classification reads this to
 * demote a container reached ONLY through such edges from a fuzzy anchor: locating where a guessed
 * symbol lives is useful, but every package that merely depends on that location is not an impact.
 */
export const isOwnershipFamilyEdge = (edgeType: string): boolean => UPWARD_ONLY.has(edgeType);
