import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { normalizeRoutePath } from './route-index.js';
import { addRouteReferenceEvidence } from './route-reference-evidence.js';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// `<a href="/deals">` pointing at the page that path routes to (epic-16, reconsidered).
//
// The earlier reasoning — "intra-app navigation, not a call across a stack boundary" — measured
// the wrong thing. Whether a relationship crosses a stack boundary is not what decides if it is
// architecture: a link from one page to another is a dependency the repository STATES, it breaks
// when the target page's route changes, and "what points at this page?" is exactly the question
// impact analysis exists to answer. It belongs in the graph.
//
// The rules are the endpoint rules, unchanged, because the honesty problem is identical:
//
// * Only `<a href>` and `<area href>` — attributes that name somewhere to GO. `<form action>` is
//   deliberately excluded: a form submits to a handler, and the handler for a page path is the
//   page's own route, which the `api-endpoint` matching already covers when one exists.
// * Only exact, normalized path equality against a declared `page:` node. No prefix matching, no
//   similarity, no parameterized-route unification. A near miss is a non-match.
// * `framework-convention` provenance with evidence from BOTH sides. Nothing in the template says
//   which file serves `/deals`; that a URL path corresponds to a file-routed page is Astro's
//   convention, and the page node it matches was itself produced by reading that convention.
//
// EDGE TYPE — `USES`, and the choice is a compromise worth naming. PRD §12.2 has no navigation
// edge; the honest type would be a `NAVIGATES_TO`, which is a §12 addition and therefore the
// domain-provenance agent's decision, not this adapter's. Of the types §12 does have, `USES` is
// the one already meaning "this component references that thing" — it is what the endpoint
// correlation directly above emits for the same class of fact — so a page link reads consistently
// with everything else rather than inventing a stronger claim (`DEPENDS_ON`) or a false one
// (`CALLS`, which a hyperlink is not).

/** The template channels that carry a document's own attributes. A `fetch` is not navigation. */
const TEMPLATE_RECEIVERS = new Set(['astro:template', 'html:template']);

const NAVIGATION_ATTRIBUTES = new Set(['a.href', 'area.href']);

const isNavigation = (fact: CallFact): boolean =>
  fact.receiverName !== undefined &&
  TEMPLATE_RECEIVERS.has(fact.receiverName) &&
  NAVIGATION_ATTRIBUTES.has(fact.calleeName);

interface PageEntry {
  readonly nodeId: string;
  readonly evidenceIds: readonly string[];
}

/**
 * A page's path comes from its §12.1.1 contract, not its display name. The two agree today, but a
 * name is presentation: reading it here would leave one more place that recovers routing structure
 * from a string, and a page without a contract states no path rather than one that failed to parse.
 */
const pagePath = (node: GraphNode): string | undefined =>
  node.type === 'page' && node.route !== undefined
    ? normalizeRoutePath(node.route.path)
    : undefined;

/**
 * Every routed page in the graph, by path. A LIST like the route index, because two files
 * claiming the same route is a repository the adapter reports rather than arbitrates.
 */
const indexPagesByPath = (graph: CodeGraph): ReadonlyMap<string, PageEntry[]> => {
  const byPath = new Map<string, PageEntry[]>();
  for (const node of graph.nodes) {
    const path = pagePath(node);
    if (path === undefined) {
      continue;
    }
    const entries = byPath.get(path) ?? [];
    entries.push({ nodeId: node.id, evidenceIds: node.knowledge.evidenceIds });
    byPath.set(path, entries);
  }
  return byPath;
};

export interface PageLinkInput {
  readonly builder: FragmentBuilder;
  readonly graph: CodeGraph;
  readonly context: IndexingContext;
  /** Resolves the node a reference comes from — shared with the endpoint linker. */
  readonly sourceIdOf: (fact: CallFact) => string;
}

interface NavigationLink {
  readonly fact: CallFact;
  readonly page: PageEntry;
  readonly sourceId: string;
  /** The `href` as written, so the correspondence record states what was read. */
  readonly literalPath: string;
  /** The normalized form used for matching. */
  readonly normalizedPath: string;
}

const link = (input: PageLinkInput, navigation: NavigationLink): void => {
  const { fact, page, sourceId } = navigation;
  const edgeId = `cross-stack:navigates:${sourceId}->${page.nodeId}`;
  const reference = addRouteReferenceEvidence({
    builder: input.builder,
    context: input.context,
    fact,
    edgeId,
    literalPath: navigation.literalPath,
    normalizedPath: navigation.normalizedPath,
    producer: 'cross-stack-page-match',
    relationship: 'NAVIGATES_TO',
  });
  input.builder.addEdge(
    {
      id: edgeId,
      // §12.2.1: `<a href>`/`<area href>` name somewhere to go. `<form action>` is excluded
      // upstream, so this producer only ever states navigation.
      type: 'NAVIGATES_TO',
      sourceId,
      targetId: page.nodeId,
      knowledge: deterministicEnvelope(
        input.context,
        [fact.evidenceId, ...page.evidenceIds, ...(reference === undefined ? [] : [reference])],
        'framework-convention',
      ),
    },
    fact.filePath,
  );
};

/**
 * Match template navigation targets against declared pages. Returns the number matched.
 *
 * A page linking to ITSELF is skipped: `<a href="/">` in the layout every page uses would
 * otherwise give the index page a self-edge that says nothing about the architecture.
 */
export const linkPageNavigation = (input: PageLinkInput): number => {
  const byPath = indexPagesByPath(input.graph);
  let matched = 0;
  for (const fact of input.graph.callFacts.filter(isNavigation)) {
    const value = fact.stringArguments[0];
    const path = value === undefined ? undefined : normalizeRoutePath(value);
    if (value === undefined || path === undefined) {
      continue;
    }
    const sourceId = input.sourceIdOf(fact);
    for (const page of byPath.get(path) ?? []) {
      if (page.nodeId !== sourceId) {
        link(input, { fact, page, sourceId, literalPath: value, normalizedPath: path });
        matched += 1;
      }
    }
  }
  return matched;
};
