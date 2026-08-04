import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { indexRoutesByPath, normalizeRoutePath } from './route-index.js';

import type { CodeGraph } from '../types.js';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * Outbound HTTP calls to an absolute URL (item 6: "Cross-repository HTTP flows … were invisible" and
 * "When another repository is unavailable, still show the outbound boundary … and unresolved
 * consumer").
 *
 * The existing route correlation matches SAME-ORIGIN paths only, and deliberately so: `/api/deals`
 * names an endpoint this graph can claim to know. But a call to
 * `https://deal-api.example.com/api/deals` is the commonest shape of a cross-service call, and
 * dropping it produced the exact failure the trials reported — the call site and the route existed in
 * the same workspace and nothing joined them.
 *
 * Two outcomes, never a guess between them:
 *
 * 1. The URL's PATH matches a route declared in this workspace → a real `CALLS_ENDPOINT` edge. The
 *    host is not checked, and that is a stated limitation, not an oversight: a workspace does not know
 *    its own deployed hostnames, and refusing the match because the host is unrecognized would drop
 *    every cross-service call in every repository.
 * 2. Nothing matches → an `unresolved-external-boundary` node naming the URL. The outbound boundary
 *    is still modelled, its consumer is explicitly unresolved, and no downstream behaviour is invented.
 */

/**
 * Every id prefix under which a `CALLS_ENDPOINT` edge is emitted in this adapter's run.
 *
 * Two prefixes because two passes produce the relationship: the same-origin template/URL correlation
 * (`cross-stack:uses:`) and this module (`edge:calls-endpoint:`). Both encode `<source>-><target>`
 * after the prefix, which is what makes the pair recoverable for the dedupe.
 */
const EDGE_ID_PREFIXES = ['cross-stack:uses:', 'edge:calls-endpoint:'] as const;

/** Receivers the language adapters use to mark an HTTP client call. */
const HTTP_CLIENT_RECEIVER = 'http:client';

const isHttpClientCall = (fact: CallFact): boolean => fact.receiverName === HTTP_CLIENT_RECEIVER;

/** `https://host/api/deals?x=1` → `/api/deals`. Absolute URLs only; same-origin is handled already. */
export const pathOfAbsoluteUrl = (value: string): string | undefined => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/[^\s]*)?$/i.exec(value);
  if (match === null) {
    return undefined;
  }
  return normalizeRoutePath(match[1] ?? '/');
};

const sourceIdOf = (fact: CallFact): string =>
  fact.enclosingSymbolNodeId ?? `file:${fact.filePath}`;

export interface OutboundHttpOutcome {
  readonly linked: number;
  readonly unresolved: number;
}

export const linkOutboundHttp = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): OutboundHttpOutcome => {
  const byPath = indexRoutesByPath(graph);
  // The same-origin correlation already emits `CALLS_ENDPOINT` for path-relative calls, and two facts
  // in one file can resolve to the same (source, route) pair. Edge ids are unique per graph, so the
  // duplicate is dropped HERE rather than being rejected later as a malformed fragment.
  const emitted = new Set([
    ...graph.edges
      .filter((edge) => edge.type === 'CALLS_ENDPOINT')
      .map((edge) => `${edge.sourceId}->${edge.targetId}`),
    // Also what THIS run has already emitted: the same-origin correlation runs earlier in the same
    // enrich, under its own `cross-stack:uses:` id prefix, and a file that states both `/api/deals`
    // and `https://host/api/deals` resolves both to the same (source, route) pair.
    ...[...builder.addedEdgeIds()].flatMap((id) =>
      EDGE_ID_PREFIXES.filter((prefix) => id.startsWith(prefix)).map((prefix) =>
        id.slice(prefix.length),
      ),
    ),
  ]);
  let linked = 0;
  let unresolved = 0;
  for (const fact of graph.callFacts) {
    if (!isHttpClientCall(fact)) {
      continue;
    }
    for (const argument of fact.stringArguments) {
      const path = pathOfAbsoluteUrl(argument);
      if (path === undefined) {
        continue; // same-origin paths are the existing correlation's business, not this one's
      }
      const routes = byPath.get(path) ?? [];
      const input: LinkInput = { builder, context, fact, url: argument, emitted };
      if (routes.length === 0) {
        unresolved += recordBoundary(input);
        continue;
      }
      linked += linkRoutes(input, routes);
    }
  }
  return { linked, unresolved };
};

interface LinkInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly fact: CallFact;
  readonly url: string;
  /** `<source>-><target>` pairs already emitted this run — edge ids are unique per graph. */
  readonly emitted: Set<string>;
}

const linkRoutes = (
  { builder, context, fact, url, emitted }: LinkInput,
  routes: readonly { nodeId: string; evidenceIds: readonly string[] }[],
): number => {
  const sourceId = sourceIdOf(fact);
  let linked = 0;
  for (const route of routes) {
    if (emitted.has(`${sourceId}->${route.nodeId}`)) {
      continue;
    }
    emitted.add(`${sourceId}->${route.nodeId}`);
    const edge = builder.addEdge(
      {
        id: `edge:calls-endpoint:${sourceId}->${route.nodeId}`,
        type: 'CALLS_ENDPOINT',
        sourceId,
        targetId: route.nodeId,
        knowledge: deterministicEnvelope(
          context,
          [fact.evidenceId, ...route.evidenceIds],
          'framework-convention',
        ),
      },
      fact.filePath,
    );
    if (edge !== undefined) {
      linked += 1;
    }
  }
  if (linked > 0) {
    builder.warn(
      'cross-stack',
      `'${url}' was matched to ${String(routes.length)} route(s) BY PATH — the host was not verified, because a workspace does not state its own deployed hostnames`,
    );
  }
  return linked;
};

/**
 * The unresolved outbound boundary. This is the honest answer for a call whose consumer is not in the
 * workspace: the call is real, the payload leaves here, and where it lands is unknown — which is a
 * different statement from "this call reaches nothing".
 */
const recordBoundary = ({ builder, context, fact, url, emitted }: LinkInput): number => {
  const boundaryId = `unresolved:http:${url}`;
  if (emitted.has(`${sourceIdOf(fact)}->${boundaryId}`)) {
    return 0;
  }
  emitted.add(`${sourceIdOf(fact)}->${boundaryId}`);
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  const node = builder.addNode(
    {
      id: boundaryId,
      category: 'integration',
      type: 'unresolved-external-boundary',
      name: url,
      knowledge,
    },
    fact.filePath,
  );
  builder.addEdge(
    {
      id: `edge:calls-endpoint:${sourceIdOf(fact)}->${boundaryId}`,
      type: 'CALLS_ENDPOINT',
      sourceId: sourceIdOf(fact),
      targetId: boundaryId,
      knowledge,
    },
    fact.filePath,
  );
  return node === undefined ? 0 : 1;
};
