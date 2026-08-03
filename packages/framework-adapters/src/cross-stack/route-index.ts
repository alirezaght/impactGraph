import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';

// Turning `route:<VERB> <path>` nodes into something matchable.
//
// Every route-producing adapter — NestJS, Express, FastAPI, Spring, Astro — deliberately emits the
// same id and name shape (`route:GET /api/deals`). That agreement is what makes cross-stack
// matching possible at all, and it is a convention this codebase enforces, not one it discovered.

export interface RouteEntry {
  readonly nodeId: string;
  readonly path: string;
  /** The HTTP verb from the route node's name, uppercased. */
  readonly verb: string;
  readonly evidenceIds: readonly string[];
}

/**
 * Normalize a URL path so two spellings of the same endpoint compare equal — and only those two.
 *
 * Query strings and fragments are dropped (they are arguments to an endpoint, not part of its
 * identity) and a trailing slash is removed. Nothing else is touched: no case folding, no
 * stripping of path parameters, no prefix matching. `/api/deals` and `/api/deal` must NOT match,
 * and the only way to guarantee that is to keep the comparison exact.
 */
export const normalizeRoutePath = (value: string): string | undefined => {
  const withoutQuery = value.split('?')[0]?.split('#')[0] ?? '';
  // Same-origin, absolute paths only. `https://…`, `//cdn…`, `mailto:`, `javascript:`, `#anchor`
  // and relative paths all name something this graph cannot claim to know.
  if (!withoutQuery.startsWith('/') || withoutQuery.startsWith('//')) {
    return undefined;
  }
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** `GET /api/deals` → verb + path; anything not shaped `<VERB> <path>` is not a route name. */
const routeNameParts = (node: GraphNode): { verb: string; path: string } | undefined => {
  const space = node.name.indexOf(' ');
  if (node.type !== 'api-endpoint' || space <= 0) {
    return undefined;
  }
  const path = normalizeRoutePath(node.name.slice(space + 1));
  return path === undefined ? undefined : { verb: node.name.slice(0, space).toUpperCase(), path };
};

/**
 * Every HTTP endpoint in the graph, grouped by path.
 *
 * A path maps to a LIST because one path carries several verbs. An `href`/`action` attribute names
 * a path and not a verb, so a template reference legitimately corresponds to all of them; claiming
 * one verb would be a guess, and claiming none would drop a real relationship.
 */
export const indexRoutesByPath = (graph: CodeGraph): ReadonlyMap<string, RouteEntry[]> => {
  const byPath = new Map<string, RouteEntry[]>();
  for (const node of graph.nodes) {
    const parts = routeNameParts(node);
    if (parts === undefined) {
      continue;
    }
    const entries = byPath.get(parts.path) ?? [];
    entries.push({
      nodeId: node.id,
      path: parts.path,
      verb: parts.verb,
      evidenceIds: node.knowledge.evidenceIds,
    });
    byPath.set(parts.path, entries);
  }
  return byPath;
};
