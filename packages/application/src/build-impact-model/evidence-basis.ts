import { primaryEvidenceType } from '@impactgraph/domain';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { MatchMechanism } from './concept-matching.js';
import type { GraphNode, ImpactEvidenceType } from '@impactgraph/domain';

/**
 * Derive the evidence basis of a candidate (item 3: "Each impact must state why it was selected").
 *
 * The basis is read off the route and the node — never off the confidence number. It is the answer
 * to "why is this here?", and because the tier ceiling is keyed on it, getting it right is what
 * stops a coincidence from being presented as an obligation.
 */

/** Relationships that make a route an async/event route rather than a call chain. */
const ASYNC_EDGE_TYPES = new Set([
  'PUBLISHES',
  'SUBSCRIBES_TO',
  'TRIGGERS',
  'BINDS',
  'DELIVERS_TO',
  'PROJECTS_TO',
  'RECORDED_IN',
]);

/** Relationships that cross a declared service or contract boundary. */
const CONTRACT_EDGE_TYPES = new Set([
  'CALLS_ENDPOINT',
  'EXPOSES',
  'SUBMITS_TO',
  'SPECIFIED_BY',
  'IMPLEMENTS_OPERATION',
]);

const FIELD_FLOW_EDGE_TYPES = new Set(['FLOWS_TO', 'RENAMED_TO', 'SERIALIZED_AS']);

const CONFIG_EDGE_TYPES = new Set(['CONFIGURES', 'DEFINES_KEY', 'RENDERS_KEY']);

/** Node types whose presence in a route means the route crossed an async boundary. */
const ASYNC_NODE_TYPES = new Set([
  'topic',
  'queue',
  'subscription',
  'publisher',
  'consumer',
  'pubsub-topic',
  'pubsub-subscription',
  'domain-event',
  'outbox-record',
]);

const CONTRACT_NODE_TYPES = new Set([
  'api-endpoint',
  'external-api',
  'third-party-service',
  'webhook',
  'openapi-document',
  'openapi-operation',
  'unresolved-external-boundary',
]);

const CONFIG_NODE_TYPES = new Set([
  'configuration-file',
  'locale-bundle',
  'translation-key',
  'json-schema',
  'template',
  'migration',
  'environment-variable',
  'terraform-resource',
  'terraform-module',
  'cloud-run-service',
  'cloud-run-job',
]);

const MECHANISM_BASIS: Readonly<Record<MatchMechanism, ImpactEvidenceType>> = {
  exact: 'direct-structural',
  alias: 'direct-structural',
  // A unique scoped path resolution IS the specification naming the file — identifier-grade.
  'path-suffix': 'direct-structural',
  // A bare filename matched one file by basename alone: a name-level guess, so it shares the
  // capped `name-similarity` basis and the `likely` ceiling records itself as `tierCappedBy`.
  basename: 'name-similarity',
  // A fuzzy name match is NOT direct structural evidence: the specification did not name this
  // component, the engine guessed it from token alignment. Filed under its own basis so the tier
  // ceiling (`likely`) applies and the guess is auditable (dogfooding item 4).
  'name-similarity': 'name-similarity',
  // The directory name is exact; the file inside it is inferred by containment. Filed under the
  // same capped basis as a fuzzy name so the `likely` ceiling and auditability apply.
  'path-segment': 'name-similarity',
  semantic: 'semantic-match',
  lexical: 'lexical-only',
};

const hasAny = (types: readonly string[], set: ReadonlySet<string>): boolean =>
  types.some((type) => set.has(type));

/**
 * The anchor case. A concept that resolved to a node by identifier IS direct structural evidence —
 * the specification named a component that exists in the graph. A concept that resolved only
 * because words overlapped is not, and says so.
 */
const anchorBasis = (candidate: ImpactCandidate, node: GraphNode): ImpactEvidenceType[] => {
  const fromMechanism = MECHANISM_BASIS[candidate.match.mechanism] ?? 'lexical-only';
  // A guessed anchor stays a guess whatever kind of node it landed on: the node-type bases below
  // describe what the node IS, but the claim's strength comes from how the specification attached
  // to it. Letting `async-event` out-rank a fuzzy or lexical mechanism would reopen the ceiling.
  if (fromMechanism !== 'direct-structural') {
    return [fromMechanism];
  }
  const bases: ImpactEvidenceType[] = [fromMechanism];
  if (CONFIG_NODE_TYPES.has(node.type)) {
    bases.push('configuration-asset');
  }
  if (ASYNC_NODE_TYPES.has(node.type)) {
    bases.push('async-event');
  }
  if (CONTRACT_NODE_TYPES.has(node.type)) {
    bases.push('external-contract');
  }
  return bases;
};

/** Each specific basis, with the edge types and node types that establish it. */
const ROUTE_RULES: readonly {
  readonly basis: ImpactEvidenceType;
  readonly edges: ReadonlySet<string>;
  readonly nodes: ReadonlySet<string>;
}[] = [
  { basis: 'async-event', edges: ASYNC_EDGE_TYPES, nodes: ASYNC_NODE_TYPES },
  { basis: 'external-contract', edges: CONTRACT_EDGE_TYPES, nodes: CONTRACT_NODE_TYPES },
  { basis: 'field-data-flow', edges: FIELD_FLOW_EDGE_TYPES, nodes: new Set(['field']) },
  { basis: 'configuration-asset', edges: CONFIG_EDGE_TYPES, nodes: CONFIG_NODE_TYPES },
];

const routeBasis = (candidate: ImpactCandidate, node: GraphNode): ImpactEvidenceType[] => {
  // A route that starts from a guessed anchor (fuzzy, semantic, or lexical) is that kind of
  // finding however far it travels: the chain is only as strong as the link that attached it to
  // the specification, so the anchor's basis poisons the whole route.
  const anchor = MECHANISM_BASIS[candidate.match.mechanism] ?? 'lexical-only';
  if (anchor !== 'direct-structural') {
    return [anchor];
  }
  const bases = ROUTE_RULES.filter(
    (rule) => hasAny(candidate.edgeTypes, rule.edges) || rule.nodes.has(node.type),
  ).map((rule) => rule.basis);
  // The generic structural basis is the fallback, not an addition. When a route crossed a topic, a
  // route, or a locale bundle, THAT is what the reader needs to know — adding `direct-structural`
  // alongside it would win the strength ordering and hide the distinction the taxonomy exists for.
  return bases.length > 0
    ? bases
    : [candidate.distance === 1 ? 'direct-structural' : 'transitive-structural'];
};

export interface EvidenceBasisResult {
  readonly evidenceTypes: readonly ImpactEvidenceType[];
  readonly primary: ImpactEvidenceType;
}

export const basisFor = (candidate: ImpactCandidate, node: GraphNode): EvidenceBasisResult => {
  const bases =
    candidate.distance === 0 ? anchorBasis(candidate, node) : routeBasis(candidate, node);
  const evidenceTypes = [...new Set(bases)];
  return { evidenceTypes, primary: primaryEvidenceType(evidenceTypes) };
};
