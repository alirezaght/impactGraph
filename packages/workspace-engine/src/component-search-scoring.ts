import type { GraphNode, KnowledgeGraph, QueryOutcome } from '@impactgraph/domain';

// Scoring for conceptual component search (item 4). Separate file so the search entry point and
// the scoring rules each stay well inside the effective-LOC budget and can be tested apart.

/**
 * How a hit was found. This is the field that makes a conceptual search safe to build on: a caller
 * (or the impact engine) can treat an `exact` hit as the component the query named and a `lexical`
 * hit as a lead worth reading, without the two being interchangeable.
 */
export const MATCH_KINDS = [
  /** The node's name equals the query, normalized. */
  'exact',
  /** The name is a normalized variant: casing, separators, or a plural. */
  'normalized-name',
  /** Multiple query terms align with the node's own tokens. */
  'conceptual',
  /** Evidence came from the node's neighbourhood: its container, its callers, its route or topic. */
  'related',
  /** Query terms appear in the node's path or documentation only. */
  'lexical',
] as const;

export type MatchKind = (typeof MATCH_KINDS)[number];

export interface ComponentSearchHit {
  readonly nodeId: string;
  readonly name: string;
  readonly category: string;
  readonly type: string;
  readonly path?: string | undefined;
  readonly provenance: string;
  readonly matchKind: MatchKind;
  readonly score: number;
  /** Which query terms matched, and where — the audit trail for a conceptual hit. */
  readonly matchedOn: readonly string[];
}

export interface ComponentSearchResult {
  readonly components: readonly ComponentSearchHit[];
  /** Distinct match kinds present, so a caller can see at a glance what grade of answer it got. */
  readonly matchKinds: readonly MatchKind[];
  readonly outcome: QueryOutcome;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const withoutExtension = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

export const tokensOf = (value: string): readonly string[] =>
  withoutExtension(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

/**
 * Stemming, deliberately minimal. "notifications" must find `Notifier`-adjacent code and
 * "rendering" must find `render`, and those two suffix families cover most of the gap between how a
 * specification writes a word and how code spells it. Anything more aggressive starts matching by
 * accident, which is the failure this whole change exists to prevent.
 */
export const stem = (token: string): string =>
  token
    .replace(/(ings|ing)$/, '')
    .replace(/(ers|er)$/, '')
    .replace(/(ions|ion)$/, '')
    .replace(/(es|s)$/, '');

const stems = (tokens: readonly string[]): ReadonlySet<string> =>
  new Set(tokens.map(stem).filter((token) => token.length >= 3));

/** Node types worth searching. Everything else is structural bookkeeping, not a component. */
const SEARCHABLE = new Set([
  'service',
  'module',
  'package',
  'class',
  'interface',
  'function',
  'method',
  'api-endpoint',
  'controller',
  'handler',
  'job',
  'cli-command',
  'ui-component',
  'page',
  'form',
  'test',
  'file',
  'symbol',
  'domain-event',
  'topic',
  'queue',
  'subscription',
  'publisher',
  'consumer',
  'webhook',
  'external-api',
  'third-party-service',
  'outbox-record',
  'push-endpoint',
  'projection',
  'unresolved-external-boundary',
  'migration',
  'table',
  'column',
  'field',
  'schema',
  'configuration-file',
  'locale-bundle',
  'translation-key',
  'json-schema',
  'openapi-document',
  'openapi-operation',
  'template',
  'event-definition',
  'generated-contract',
  'pubsub-topic',
  'pubsub-subscription',
  'cloud-run-service',
  'cloud-run-job',
  'terraform-resource',
  'terraform-module',
  'environment-variable',
  'bounded-context',
  'aggregate',
  'entity',
  'value-object',
  'command',
  'query',
]);

export const candidatesFor = (
  graph: KnowledgeGraph,
  nodeTypes: readonly string[] | undefined,
): readonly GraphNode[] => {
  const allowed = nodeTypes === undefined ? undefined : new Set(nodeTypes);
  return [...graph.nodes.values()].filter((node) =>
    allowed === undefined ? SEARCHABLE.has(node.type) : allowed.has(node.type),
  );
};

/** Names of a node's immediate graph neighbourhood — the `related` evidence channel. */
const neighbourNames = (graph: KnowledgeGraph, node: GraphNode): readonly string[] => {
  const names: string[] = [];
  const edgeIds = [...(graph.outgoing.get(node.id) ?? []), ...(graph.incoming.get(node.id) ?? [])];
  for (const edgeId of edgeIds.slice(0, 24)) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined) {
      continue;
    }
    const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
    const other = graph.nodes.get(otherId);
    if (other !== undefined) {
      names.push(other.name);
    }
  }
  return names;
};

interface Channel {
  readonly kind: MatchKind;
  readonly weight: number;
  readonly label: string;
}

const NAME_CHANNEL: Channel = { kind: 'conceptual', weight: 0.34, label: 'name' };
const PATH_CHANNEL: Channel = { kind: 'lexical', weight: 0.12, label: 'path' };
const TYPE_CHANNEL: Channel = { kind: 'lexical', weight: 0.06, label: 'kind' };
const NEIGHBOUR_CHANNEL: Channel = { kind: 'related', weight: 0.1, label: 'neighbourhood' };

const overlap = (queryStems: ReadonlySet<string>, text: readonly string[]): number => {
  const textStems = stems(text);
  let hits = 0;
  for (const token of queryStems) {
    if (textStems.has(token)) {
      hits += 1;
    }
  }
  return hits;
};

const STRONGEST: readonly MatchKind[] = [
  'exact',
  'normalized-name',
  'conceptual',
  'related',
  'lexical',
];

const strongest = (kinds: readonly MatchKind[]): MatchKind =>
  STRONGEST.find((kind) => kinds.includes(kind)) ?? 'lexical';

/**
 * Score one node against the query. Returns undefined when no channel matched at all — a search
 * result must never contain a node the query has no relationship to whatsoever.
 */
export const scoreNode = (
  node: GraphNode,
  query: string,
  queryTokens: readonly string[],
  graph: KnowledgeGraph,
): ComponentSearchHit | undefined => {
  const base = {
    nodeId: node.id,
    name: node.name,
    category: node.category,
    type: node.type,
    path: node.path,
    provenance: node.knowledge.provenance,
  };
  const normalizedQuery = normalize(query);
  if (normalize(node.name) === normalizedQuery) {
    return { ...base, matchKind: 'exact', score: 1, matchedOn: ['name (exact)'] };
  }
  if (normalize(withoutExtension(node.name)) === normalize(withoutExtension(query))) {
    return { ...base, matchKind: 'normalized-name', score: 0.9, matchedOn: ['name (normalized)'] };
  }
  const queryStems = stems(queryTokens);
  if (queryStems.size === 0) {
    return undefined;
  }
  const channels: { channel: Channel; hits: number }[] = [
    { channel: NAME_CHANNEL, hits: overlap(queryStems, tokensOf(node.name)) },
    { channel: PATH_CHANNEL, hits: overlap(queryStems, tokensOf(node.path ?? '')) },
    { channel: TYPE_CHANNEL, hits: overlap(queryStems, tokensOf(node.type)) },
    {
      channel: NEIGHBOUR_CHANNEL,
      hits: overlap(
        queryStems,
        neighbourNames(graph, node).flatMap((name) => tokensOf(name)),
      ),
    },
  ].filter((entry) => entry.hits > 0);
  if (channels.length === 0) {
    return undefined;
  }
  // Normalized by query length so a long conceptual query cannot out-score a short precise one just
  // by having more terms to hit.
  const score = Math.min(
    0.85,
    channels.reduce(
      (sum, entry) => sum + entry.channel.weight * (entry.hits / queryStems.size) * 3,
      0,
    ),
  );
  return {
    ...base,
    matchKind: strongest(channels.map((entry) => entry.channel.kind)),
    score: Math.round(score * 100) / 100,
    matchedOn: channels.map(
      (entry) => `${entry.channel.label} (${String(entry.hits)}/${String(queryStems.size)} terms)`,
    ),
  };
};
