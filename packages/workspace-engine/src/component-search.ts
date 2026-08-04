import { queryOutcome } from '@impactgraph/domain';

import { candidatesFor, scoreNode } from './component-search-scoring.js';
import { failWith } from './failure.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { ComponentSearchHit, ComponentSearchResult } from './component-search-scoring.js';
import type { Failable } from './failure.js';
import type { KnowledgeGraph } from '@impactgraph/domain';

/**
 * Conceptual component search (item 4: "Reasonable conceptual component searches returned nothing,
 * while exact identifier searches worked").
 *
 * The old implementation was `name.includes(query) || path.includes(query)`. A query like
 * "NDA signature request notification message rendering buyer seller" contains no substring that
 * appears in any identifier, so it matched nothing — while `MessageRenderer` matched instantly. That
 * is exactly backwards from what a discovery tool is for: you search conceptually precisely BECAUSE
 * you do not know the identifier.
 *
 * The fix is to score against several kinds of evidence and to LABEL which kind produced each hit,
 * so a caller can tell an identifier match from a conceptual one — and so the impact engine can cap
 * what a conceptual match is allowed to claim (item 3).
 */

export interface ComponentSearchOptions {
  readonly limit?: number;
  /** Only these node types. */
  readonly nodeTypes?: readonly string[];
  /** Include lexical-grade hits (token overlap only). Default: true for search, unlike impacts. */
  readonly includeLexical?: boolean;
  /**
   * Item 6: what the registered-repository roster says was and was not analyzed. Supplied by the
   * caller because reading configuration is its job, not the search's — and defaulted to the
   * single-repository sentence so an empty result is never unscoped.
   */
  readonly crossRepositoryLimitations?: readonly string[];
}

const DEFAULT_LIMIT = 25;

const scopeOf = (graph: KnowledgeGraph, snapshotId: string): string =>
  `the indexed knowledge graph of this workspace at snapshot ${snapshotId} (${String(graph.nodes.size)} components, ${String(graph.edges.size)} relationships)`;

/**
 * A query is UNSUPPORTED when nothing in it can be matched at all: no usable token survives
 * normalization. Reporting that is different from reporting absence — the caller should rephrase,
 * not conclude the repository lacks the thing.
 */
const usableTokens = (query: string): readonly string[] =>
  query
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9_.]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2);

export const searchComponents = async (
  rootDir: string,
  query: string,
  options: ComponentSearchOptions = {},
): Promise<Failable<ComponentSearchResult>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    const scope = scopeOf(graph, current.value.snapshotId);
    const tokens = usableTokens(query);
    if (tokens.length === 0) {
      return {
        ok: true,
        value: {
          components: [],
          outcome: {
            status: 'failed' as const,
            scope,
            limitations: [],
            resultCount: 0,
            reason:
              'the query contains no searchable term — it normalized to nothing. Include an identifier, a path fragment, or at least one word of two characters or more.',
          },
          matchKinds: [],
        },
      };
    }
    if (graph.nodes.size === 0) {
      return {
        ok: true,
        value: {
          components: [],
          outcome: {
            status: 'not-run' as const,
            scope,
            limitations: [
              'The workspace has no indexed components, so no search was performed. Run `impactgraph index` first.',
            ],
            resultCount: 0,
          },
          matchKinds: [],
        },
      };
    }
    return { ok: true, value: rank({ graph, query, tokens, scope, options }) };
  });

interface RankInput {
  readonly graph: KnowledgeGraph;
  readonly query: string;
  readonly tokens: readonly string[];
  readonly scope: string;
  readonly options: ComponentSearchOptions;
}

const rank = ({ graph, query, tokens, scope, options }: RankInput): ComponentSearchResult => {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const includeLexical = options.includeLexical ?? true;
  const hits: ComponentSearchHit[] = [];
  for (const node of candidatesFor(graph, options.nodeTypes)) {
    const scored = scoreNode(node, query, tokens, graph);
    if (scored === undefined) {
      continue;
    }
    if (!includeLexical && scored.matchKind === 'lexical') {
      continue;
    }
    hits.push(scored);
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.matchKind.localeCompare(b.matchKind) ||
      a.nodeId.localeCompare(b.nodeId),
  );
  const page = hits.slice(0, limit);
  const limitations: string[] = [
    ...(options.crossRepositoryLimitations ?? [
      'Only this workspace was searched; repositories not registered in the workspace were not analyzed.',
    ]),
    ...(includeLexical ? [] : ['Lexical-grade matches were excluded from this search.']),
  ];
  return {
    components: page,
    matchKinds: [...new Set(page.map((hit) => hit.matchKind))].sort(),
    outcome: queryOutcome({
      scope,
      resultCount: hits.length,
      limitations,
      ...(hits.length > page.length
        ? {
            partialReason: `${String(hits.length - page.length)} further match(es) beyond the limit of ${String(limit)}`,
          }
        : {}),
    }),
  };
};

export const componentSearchFailure = (message: string): Failable<never> =>
  failWith('configurationError', message);
