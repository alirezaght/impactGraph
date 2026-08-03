import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// Astro's file-based routing (PRD §15.2): everything under `src/pages` is a route, named by its
// path. `src/pages/index.astro` is `/`, `src/pages/about.astro` is `/about`,
// `src/pages/api/deals.ts` is `/api/deals`. This is a convention over paths, so it belongs to
// framework enrichment and carries `framework-convention` provenance.

const PAGES_ROOT = 'src/pages/';

const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'ALL']);

/** `src/pages/blog/index.astro` → '/blog'; `src/pages/api/deals.ts` → '/api/deals'. */
export const routeOf = (relativePath: string): string | undefined => {
  const index = relativePath.indexOf(PAGES_ROOT);
  if (index === -1) {
    return undefined;
  }
  const tail = relativePath.slice(index + PAGES_ROOT.length);
  const withoutExtension = tail.slice(0, tail.lastIndexOf('.'));
  const segments = withoutExtension.split('/').filter((part) => part !== '' && part !== 'index');
  return `/${segments.join('/')}`;
};

export interface RouteEmitInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly sourceNodeId: string;
  readonly filePath: string;
  readonly evidenceId: string;
}

const addRouteNode = (
  input: RouteEmitInput,
  nodeId: string,
  nodeType: 'page' | 'api-endpoint',
  name: string,
): void => {
  const knowledge = deterministicEnvelope(
    input.context,
    [input.evidenceId],
    'framework-convention',
  );
  input.builder.addNode(
    {
      id: nodeId,
      category: 'application',
      type: nodeType,
      name,
      path: input.filePath,
      knowledge,
    },
    input.filePath,
  );
  input.builder.addEdge(
    {
      id: `astro:exposes:${input.sourceNodeId}->${nodeId}`,
      type: 'EXPOSES',
      sourceId: input.sourceNodeId,
      targetId: nodeId,
      knowledge,
    },
    input.filePath,
  );
};

/** Every `.astro` component under `src/pages` exposes the page its path names. */
export const addPages = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  for (const node of graph.nodes) {
    const route = componentRoute(node);
    if (route === undefined) {
      continue;
    }
    addRouteNode(
      {
        builder,
        context,
        sourceNodeId: String(node.id),
        filePath: node.path ?? '',
        evidenceId: node.knowledge.evidenceIds[0] ?? '',
      },
      `page:${route}`,
      'page',
      route,
    );
  }
};

const componentRoute = (node: GraphNode): string | undefined => {
  const path = node.path;
  if (node.type !== 'ui-component' || path === undefined || !path.endsWith('.astro')) {
    return undefined;
  }
  return routeOf(path);
};

/**
 * An Astro API route is a plain TypeScript module under `src/pages/api` that exports one symbol
 * per HTTP verb — already indexed by the TypeScript adapter, so enrichment only has to read the
 * exported names it produced (PRD §31: never re-parse a file a language adapter handled).
 */
export const addApiRoutes = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  for (const node of graph.nodes) {
    const path = node.path;
    if (path === undefined || !path.includes(`${PAGES_ROOT}api/`) || node.path === node.name) {
      continue;
    }
    const verb = node.name;
    const route = routeOf(path);
    if (!HTTP_EXPORTS.has(verb) || route === undefined) {
      continue;
    }
    addRouteNode(
      {
        builder,
        context,
        sourceNodeId: String(node.id),
        filePath: path,
        evidenceId: node.knowledge.evidenceIds[0] ?? '',
      },
      `route:${verb} ${route}`,
      'api-endpoint',
      `${verb} ${route}`,
    );
  }
};
