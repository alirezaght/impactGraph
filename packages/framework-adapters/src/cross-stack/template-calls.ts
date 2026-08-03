import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { indexRoutesByPath, normalizeRoutePath } from './route-index.js';

import type { RouteEntry } from './route-index.js';
import type { CodeGraph } from '../types.js';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// PRD §C13, "Astro → FastAPI": a template that points at `/api/deals` and a backend that serves
// `/api/deals` are talking about the same endpoint.
//
// This is the honesty boundary of the whole cross-stack story, so the rules are narrow on purpose:
//
// * Only `a[href]` and `form[action]` — attributes that name an ENDPOINT. `img[src]`,
//   `script[src]` and `link[href]` name assets and are ignored.
// * Only exact, normalized path equality. No prefix matching, no similarity scoring, no
//   parameterized-route unification (`/deals/1` does not match `/deals/{id}`) — a near miss is a
//   non-match, and a missed edge is cheaper than a fabricated one.
// * Only `api-endpoint` targets. An `<a href="/about">` pointing at a `page:` node is intra-app
//   navigation, not a call across a stack boundary, and is deliberately left out.
// * Provenance is `framework-convention`, never `static-analysis`. Nothing in the template SAYS
//   which handler serves that URL; that a shared URL path means a shared endpoint is a convention
//   of HTTP applications. Evidence from both sides is attached so a reviewer can check it.

/**
 * The channel markers the template readers stamp on document reference facts: `.astro` templates
 * and standalone `.html` documents state the same kind of thing and are matched by the same rules.
 */
const TEMPLATE_RECEIVERS = new Set(['astro:template', 'html:template']);

/**
 * The marker the TypeScript adapter stamps on `fetch('<literal>')` (Story 16.6, last open task).
 * A URL a `.ts` file points at is the same kind of correspondence as one an `.astro` template
 * points at, so it is matched by the same rules — no prefix matching, no similarity, exact path.
 */
const HTTP_CALL_RECEIVER = 'http:client';

const ENDPOINT_ATTRIBUTES = new Set(['a.href', 'form.action']);

const isEndpointReference = (fact: CallFact): boolean => {
  if (fact.receiverName !== undefined && TEMPLATE_RECEIVERS.has(fact.receiverName)) {
    return ENDPOINT_ATTRIBUTES.has(fact.calleeName);
  }
  return fact.receiverName === HTTP_CALL_RECEIVER;
};

const templateReferences = (graph: CodeGraph): readonly CallFact[] =>
  graph.callFacts.filter(isEndpointReference);

/**
 * The node a reference comes FROM: the declaration that contains the call when the adapter named
 * one, else the file's own component, else the file. Never invented — a reference always has a
 * file behind it, and an `enclosingSymbolNodeId` the graph does not know is discarded rather than
 * turned into a dangling edge.
 */
export const referenceSourceId = (graph: CodeGraph, fact: CallFact): string => {
  const enclosing = fact.enclosingSymbolNodeId;
  if (enclosing !== undefined && graph.nodes.some((node) => node.id === enclosing)) {
    return enclosing;
  }
  const component = graph.nodes.find(
    (node) => node.type === 'ui-component' && node.path === fact.filePath,
  );
  return component?.id ?? `file:${fact.filePath}`;
};

interface LinkInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly sourceId: string;
  readonly fact: CallFact;
}

const linkRoute = (input: LinkInput, route: RouteEntry): void => {
  const { builder, context, sourceId, fact } = input;
  builder.addEdge(
    {
      id: `cross-stack:uses:${sourceId}->${route.nodeId}`,
      type: 'USES',
      sourceId,
      targetId: route.nodeId,
      // Both sides: the template attribute that names the path, and the declaration of the route
      // that serves it. A correspondence claim with evidence from only one side is unreviewable.
      knowledge: deterministicEnvelope(
        context,
        [fact.evidenceId, ...route.evidenceIds],
        'framework-convention',
      ),
    },
    fact.filePath,
  );
};

/** Match template endpoint references against declared HTTP routes. Returns the number matched. */
export const linkTemplateReferences = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): number => {
  const byPath = indexRoutesByPath(graph);
  let matched = 0;
  for (const fact of templateReferences(graph)) {
    const value = fact.stringArguments[0];
    const path = value === undefined ? undefined : normalizeRoutePath(value);
    const candidates = path === undefined ? [] : (byPath.get(path) ?? []);
    // A `<form method>` (or a fetch `{ method }`) states the verb, so link only that route.
    // With no stated method the reference names a path and not a verb — every verb at that path
    // is a legitimate correspondence, and picking one would be a guess (HTML's GET default is a
    // browser behavior, not something the repository declared).
    const declaredVerb = fact.keywordStringArguments?.['method']?.toUpperCase();
    const routes =
      declaredVerb === undefined
        ? candidates
        : candidates.filter((route) => route.verb === declaredVerb);
    const sourceId = referenceSourceId(graph, fact);
    for (const route of routes) {
      linkRoute({ builder, context, sourceId, fact }, route);
      matched += 1;
    }
  }
  return matched;
};
