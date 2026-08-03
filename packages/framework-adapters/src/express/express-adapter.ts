import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import { routeIdentity } from '../route-contract.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { CallFact, GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Story 3.3 — Express enrichment from module-level call facts (PRD §15.2). Routers, route
// handlers, mounting, and middleware — all with `framework-convention` provenance and the
// call-site evidence that triggered them. Statically underivable paths are skipped, never guessed.

const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

const isAppCreation = (fact: CallFact): boolean =>
  fact.calleeName === 'express' && fact.receiverName === undefined && fact.assignedTo !== undefined;

const isRouterCreation = (fact: CallFact): boolean =>
  fact.calleeName === 'Router' && fact.assignedTo !== undefined;

const joinPath = (...segments: readonly (string | undefined)[]): string => {
  const parts = segments
    .filter((segment): segment is string => segment !== undefined && segment.length > 0)
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
};

/** (file, variable) → mount prefix, resolved from `app.use('/x', router)` across files. */
const buildMountPrefixes = (
  graph: CodeGraph,
  receivers: ReadonlySet<string>,
): Map<string, string> => {
  const prefixes = new Map<string, string>();
  for (const fact of graph.callFacts) {
    const mountedName = fact.identifierArguments[0];
    const prefix = fact.stringArguments[0];
    const isMount =
      fact.calleeName === 'use' &&
      fact.receiverName !== undefined &&
      receivers.has(`${fact.filePath}#${fact.receiverName}`) &&
      prefix !== undefined &&
      mountedName !== undefined;
    if (!isMount) {
      continue;
    }
    const targetId = graph.resolveSymbol(fact.filePath, mountedName);
    // Router symbols look like `symbol:<file>#<name>` — key mounted routers by (file, name).
    if (targetId?.startsWith('symbol:') === true) {
      prefixes.set(targetId.slice('symbol:'.length), prefix);
    }
  }
  return prefixes;
};

interface ExpressWorld {
  /** `<file>#<var>` keys for every express() app and Router() instance. */
  readonly receivers: ReadonlySet<string>;
  readonly mountPrefixes: ReadonlyMap<string, string>;
}

const discover = (graph: CodeGraph): ExpressWorld => {
  const receivers = new Set<string>();
  for (const fact of graph.callFacts) {
    if (isAppCreation(fact) || isRouterCreation(fact)) {
      receivers.add(`${fact.filePath}#${fact.assignedTo ?? ''}`);
    }
  }
  return { receivers, mountPrefixes: buildMountPrefixes(graph, receivers) };
};

interface RouteInput {
  readonly builder: FragmentBuilder;
  readonly graph: CodeGraph;
  readonly fact: CallFact;
  readonly world: ExpressWorld;
  readonly context: IndexingContext;
}

const addRoute = ({ builder, graph, fact, world, context }: RouteInput): void => {
  const method = fact.calleeName.toUpperCase();
  const receiverKey = `${fact.filePath}#${fact.receiverName ?? ''}`;
  const prefix = world.mountPrefixes.get(receiverKey);
  const fullPath = joinPath(prefix, fact.stringArguments[0]);
  const identity = routeIdentity(method, fullPath);
  const routeNodeId = identity.nodeId;
  builder.addNode(
    {
      id: routeNodeId,
      category: 'application',
      type: 'api-endpoint',
      name: identity.name,
      route: identity.route,
      path: fact.filePath,
      knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
    },
    fact.filePath,
  );
  // EXPOSES from the registering file, plus from the handler symbol when it resolves.
  const sources = [`file:${fact.filePath}`];
  const handlerName = fact.identifierArguments[fact.identifierArguments.length - 1];
  if (handlerName !== undefined) {
    const handlerId = graph.resolveSymbol(fact.filePath, handlerName);
    if (handlerId !== undefined) {
      sources.push(handlerId);
    }
  }
  for (const sourceId of sources) {
    builder.addEdge(
      {
        id: `express:exposes:${sourceId}->${routeNodeId}`,
        type: 'EXPOSES',
        sourceId,
        targetId: routeNodeId,
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
      },
      fact.filePath,
    );
  }
};

interface MiddlewareRegistration {
  readonly id: string;
  readonly evidenceId: string;
}

const addMiddleware = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  fact: CallFact,
  context: IndexingContext,
): MiddlewareRegistration[] => {
  // `app.use(fn)` without a path string → application-level middleware.
  const registered: MiddlewareRegistration[] = [];
  for (const name of fact.identifierArguments) {
    const middlewareId = graph.resolveSymbol(fact.filePath, name);
    if (middlewareId === undefined || !middlewareId.startsWith('symbol:')) {
      continue;
    }
    builder.addEdge(
      {
        id: `express:uses:file:${fact.filePath}->${middlewareId}`,
        // §12.2.1: attachment, not dispatch. Source is the file wiring it up, target the middleware.
        type: 'USES_MIDDLEWARE',
        sourceId: `file:${fact.filePath}`,
        targetId: middlewareId,
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
      },
      fact.filePath,
    );
    registered.push({ id: middlewareId, evidenceId: fact.evidenceId });
  }
  return registered;
};

/** Chain order: middleware N calls next() into middleware N+1 — modeled as TRIGGERS (§12.2). */
const addMiddlewareOrdering = (
  builder: FragmentBuilder,
  chains: ReadonlyMap<string, readonly MiddlewareRegistration[]>,
  context: IndexingContext,
): void => {
  for (const [filePath, chain] of chains) {
    addChainEdges(builder, filePath, chain, context);
  }
};

const addChainEdges = (
  builder: FragmentBuilder,
  filePath: string,
  chain: readonly MiddlewareRegistration[],
  context: IndexingContext,
): void => {
  for (let index = 0; index + 1 < chain.length; index += 1) {
    const current = chain[index];
    const next = chain[index + 1];
    if (current === undefined || next === undefined || current.id === next.id) {
      continue;
    }
    builder.addEdge(
      {
        id: `express:triggers:${current.id}->${next.id}`,
        type: 'TRIGGERS',
        sourceId: current.id,
        targetId: next.id,
        knowledge: deterministicEnvelope(
          context,
          [current.evidenceId, next.evidenceId],
          'framework-convention',
        ),
      },
      filePath,
    );
  }
};

class ExpressAdapter implements FrameworkAdapter {
  public readonly id = 'express';
  public readonly languageIds: readonly string[] = ['typescript'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const markers = graph.callFacts.filter((fact) => isAppCreation(fact) || isRouterCreation(fact));
    return Promise.resolve({
      detected: markers.length > 0,
      evidenceIds: markers.map((fact) => fact.evidenceId),
      reason:
        markers.length > 0
          ? `Express app/router creation present (${String(markers.length)} sites)`
          : 'no Express usage found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    const world = discover(graph);
    const chains = new Map<string, MiddlewareRegistration[]>();
    const collectMiddleware = (fact: CallFact): void => {
      const chain = chains.get(fact.filePath) ?? [];
      chain.push(...addMiddleware(builder, graph, fact, context.indexing));
      chains.set(fact.filePath, chain);
    };
    for (const fact of graph.callFacts) {
      const receiverKey = `${fact.filePath}#${fact.receiverName ?? ''}`;
      if (fact.receiverName === undefined || !world.receivers.has(receiverKey)) {
        continue;
      }
      if (HTTP_VERBS.has(fact.calleeName) && fact.stringArguments[0] !== undefined) {
        addRoute({ builder, graph, fact, world, context: context.indexing });
      } else if (fact.calleeName === 'use' && fact.stringArguments.length === 0) {
        collectMiddleware(fact);
      }
    }
    addMiddlewareOrdering(builder, chains, context.indexing);
    return Promise.resolve(builder.build());
  }
}

export const createExpressAdapter = (): FrameworkAdapter => new ExpressAdapter();
