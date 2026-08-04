import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * The consumer half of the chain (item 5): topic/subscription → push endpoint → projection.
 *
 * A Pub/Sub push subscription delivers to an ordinary HTTP route. Nothing about that route looks like
 * messaging — it is a POST handler — so the subscription and the handler that serves it were two
 * unrelated facts, and the chain ended at the topic.
 */

const routeNodes = (graph: CodeGraph): readonly GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'api-endpoint');

/**
 * Route paths that are Pub/Sub push endpoints by convention.
 *
 * The alternative — reading `push_endpoint` out of the Terraform resource — is strictly better and is
 * NOT available: the Terraform adapter captures top-level attributes, and `push_endpoint` lives
 * inside a nested `push_config` block. So this link rests on a naming convention, and it says so:
 * the provenance is `framework-convention`, never `static-analysis`, and the convention is listed
 * here where a reader can argue with it. `/_ah/push-handlers/` is Google's own default prefix.
 */
const PUSH_ROUTE_PATH = /(^|\/)(_ah\/push-handlers|pubsub|push|messages?\/receive)(\/|$)/i;

/**
 * The route's declared path, from its RouteContract (§12.1.1). Never from the display name: the name
 * is presentation, and recovering structure from it is exactly the mistake `route-contract.test.ts`
 * guards against. A route node with no contract cannot be matched, and is skipped rather than parsed.
 */
const declaredPathOf = (route: GraphNode): string | undefined => route.route?.path;

/**
 * Subscriptions whose push endpoint resolves to a route in this repository.
 *
 * The endpoint is read from the subscription node's own name/path facts where an adapter recorded
 * one; where it did not, nothing is emitted. A push endpoint that points at a host we do not index is
 * an unresolved boundary, not a missing edge — reported below.
 */
/** The file that declares a node, via the CONTAINS edge, when the node carries no path itself. */
const declaringPathOf = (graph: CodeGraph, nodeId: string): string | undefined => {
  const containing = graph.edges.find(
    (edge) => edge.type === 'CONTAINS' && edge.targetId === nodeId,
  );
  const container =
    containing === undefined
      ? undefined
      : graph.nodes.find((node) => node.id === containing.sourceId);
  return container?.path;
};

export const linkPushEndpoints = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): readonly string[] => {
  const candidates = routeNodes(graph).filter((route) => {
    const path = declaredPathOf(route);
    return path !== undefined && PUSH_ROUTE_PATH.test(path);
  });
  const route = candidates.length === 1 ? candidates[0] : undefined;
  const subscriptions = graph.nodes.filter(
    (node) => node.type === 'pubsub-subscription' || node.type === 'subscription',
  );
  const deliveryPaths: string[] = [];
  for (const node of subscriptions) {
    const evidenceIds = [...node.knowledge.evidenceIds];
    if (route === undefined) {
      recordUnresolved(builder, context, node, candidates.length);
      continue;
    }
    // The route is a push endpoint AS WELL AS a route: the fact is added, the route node is not
    // retyped. Retyping would destroy the HTTP fact another adapter proved.
    const pushId = `push:${route.id}`;
    const routePath = route.path ?? declaringPathOf(graph, route.id);
    builder.addNode(
      {
        id: pushId,
        category: 'integration',
        type: 'push-endpoint',
        name: route.name,
        ...(routePath === undefined ? {} : { path: routePath }),
        knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
      },
      routePath ?? 'async-chain',
    );
    for (const [sourceId, targetId, type] of [
      [node.id, pushId, 'DELIVERS_TO'],
      [pushId, route.id, 'EXPOSES'],
    ] as const) {
      builder.addEdge(
        {
          id: `edge:${type.toLowerCase()}:${sourceId}->${targetId}`,
          type,
          sourceId,
          targetId,
          knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
        },
        routePath ?? 'async-chain',
      );
    }
    if (routePath !== undefined) {
      deliveryPaths.push(routePath);
    }
  }
  return deliveryPaths;
};

/**
 * REFUSAL: with zero or several push-shaped routes there is no single target this subscription can be
 * proved to deliver to. The boundary is recorded as UNRESOLVED rather than guessed, so a reader sees
 * that the chain leaves the provable scope instead of concluding it ends (item 11).
 */
const recordUnresolved = (
  builder: FragmentBuilder,
  context: IndexingContext,
  node: GraphNode,
  candidateCount: number,
): void => {
  const evidenceIds = [...node.knowledge.evidenceIds];
  builder.addNode(
    {
      id: `unresolved:push:${node.id}`,
      category: 'integration',
      type: 'unresolved-external-boundary',
      name: `${node.name} → (${String(candidateCount)} candidate push routes in this repository)`,
      knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
    },
    'async-chain',
  );
  builder.warn(
    'async-chain',
    `subscription '${node.name}' has ${String(candidateCount)} push-shaped route(s) in this repository — its delivery target is recorded as an unresolved boundary rather than guessed`,
  );
};

/** Symbol names that mean "maintain a read model from this message". */
const PROJECTION_NAME = /^(project|apply|upsert)([A-Z_]|$)/;

/**
 * delivery site → projection.
 *
 * The evidence is an IMPORT plus a naming convention: the file that serves the push route imports a
 * module, and that module declares a symbol whose name says it projects. Imports are used rather
 * than call facts on purpose — the call is `projectNotification(req.body)` inside a route callback,
 * which carries no string literal and is therefore not a call fact, while the import is a hard
 * parsed edge. The naming convention is what narrows the import to a projection, and it is stated
 * here so a reader can judge it; the provenance is `framework-convention`, never `static-analysis`.
 */
export const linkProjections = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
  pushPaths: readonly string[] = [],
): number => {
  // Delivery sites are the push routes this run just linked, plus any consumer the graph already
  // carries. The push paths are passed in rather than re-read from the graph: the nodes this adapter
  // emits are not visible in `graph` — a framework adapter reads the graph as it was.
  const deliveryPaths = new Set([
    ...pushPaths,
    ...graph.nodes
      .filter((node) => node.type === 'consumer')
      .map((node) => node.path)
      .filter((path): path is string => path !== undefined),
  ]);
  if (deliveryPaths.size === 0) {
    return 0;
  }
  const fileIds = new Set(
    graph.nodes
      .filter((node) => node.path !== undefined && deliveryPaths.has(node.path))
      .map((node) => node.id),
  );
  let linked = 0;
  for (const symbol of projectionSymbols(graph, fileIds)) {
    const projectionId = `projection:${symbol.id}`;
    const evidenceIds = [...symbol.knowledge.evidenceIds];
    builder.addNode(
      {
        id: projectionId,
        category: 'integration',
        type: 'projection',
        name: symbol.name,
        ...(symbol.path === undefined ? {} : { path: symbol.path }),
        knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
      },
      symbol.path ?? 'async-chain',
    );
    builder.addEdge(
      {
        id: `edge:projects-to:${projectionId}`,
        type: 'PROJECTS_TO',
        sourceId: symbol.deliveryFileId,
        targetId: projectionId,
        knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
      },
      symbol.path ?? 'async-chain',
    );
    // symbol IMPLEMENTS projection, not projection CONTAINS symbol. Direction matters: CONTAINS is
    // walked upward only (to avoid sibling explosion), so a downward CONTAINS would leave the
    // projection a dead end and the rendering path beyond it unreachable. IMPLEMENTS is the truthful
    // relationship anyway — the function implements the projection role — and it propagates.
    builder.addEdge(
      {
        id: `edge:projection-symbol:${projectionId}`,
        type: 'IMPLEMENTS',
        sourceId: symbol.id,
        targetId: projectionId,
        knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
      },
      symbol.path ?? 'async-chain',
    );
    linked += 1;
  }
  return linked;
};

interface ProjectionSymbol extends GraphNode {
  readonly deliveryFileId: string;
}

/** Symbols matching the projection convention in modules a delivery site imports. */
const projectionSymbols = (
  graph: CodeGraph,
  deliveryFileIds: ReadonlySet<string>,
): readonly ProjectionSymbol[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const found: ProjectionSymbol[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== 'IMPORTS' || !deliveryFileIds.has(edge.sourceId)) {
      continue;
    }
    for (const contained of graph.edges) {
      if (contained.type !== 'CONTAINS' || contained.sourceId !== edge.targetId) {
        continue;
      }
      const symbol = byId.get(contained.targetId);
      if (symbol === undefined || !PROJECTION_NAME.test(symbol.name) || seen.has(symbol.id)) {
        continue;
      }
      seen.add(symbol.id);
      found.push({ ...symbol, deliveryFileId: edge.sourceId });
    }
  }
  return found;
};
