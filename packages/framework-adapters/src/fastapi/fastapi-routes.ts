import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { routeIdentity } from '../route-contract.js';

import { appNodeId, holderKey, routerNodeId } from './fastapi-world.js';

import type { FastApiWorld, Holder } from './fastapi-world.js';
import type { CodeGraph } from '../types.js';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// Routes, routers, and their mounting (PRD §15.2). Neutral §12 vocabulary only: an endpoint is
// an `api-endpoint`, a router is a `module` — FastAPI identity lives in `framework-convention`
// provenance plus the decorator/call evidence, never in a new node type.

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']);

const joinPath = (...segments: readonly string[]): string => {
  const parts = segments.flatMap((segment) => segment.split('/')).filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
};

const nodeIdFor = (holder: Holder): string =>
  holder.kind === 'app' ? appNodeId(holder.key) : routerNodeId(holder.key);

export interface RouteEmitInput {
  readonly builder: FragmentBuilder;
  readonly graph: CodeGraph;
  readonly world: FastApiWorld;
  readonly context: IndexingContext;
}

/** `app = FastAPI()` / `router = APIRouter()` become the components routes hang off. */
export const addHolderNodes = ({ builder, world, context }: RouteEmitInput): void => {
  for (const holder of world.holders.values()) {
    builder.addNode(
      {
        id: nodeIdFor(holder),
        category: 'application',
        type: holder.kind === 'app' ? 'application' : 'module',
        name: holder.variable,
        path: holder.filePath,
        knowledge: deterministicEnvelope(context, [holder.evidenceId], 'framework-convention'),
      },
      holder.filePath,
    );
  }
};

export const addMountEdges = ({ builder, world, context }: RouteEmitInput): void => {
  for (const mount of world.mounts) {
    const parent = world.holders.get(mount.parentKey);
    const child = world.holders.get(mount.childKey);
    if (parent === undefined || child === undefined) {
      continue;
    }
    builder.addEdge(
      {
        id: `fastapi:contains:${nodeIdFor(parent)}->${nodeIdFor(child)}`,
        type: 'CONTAINS',
        sourceId: nodeIdFor(parent),
        targetId: nodeIdFor(child),
        knowledge: deterministicEnvelope(context, [mount.evidenceId], 'framework-convention'),
      },
      parent.filePath,
    );
  }
  for (const unresolved of world.unresolvedMounts) {
    builder.warn(
      unresolved.filePath,
      `include_router('${unresolved.name}') could not be resolved to a router — routes left unprefixed`,
    );
  }
};

interface RouteSpec {
  readonly holder: Holder;
  readonly method: string;
  readonly path: string;
  readonly handlerNodeId: string;
  readonly evidenceId: string;
  readonly filePath: string;
}

const routeSpecOf = (
  world: FastApiWorld,
  decoratorName: string,
  filePath: string,
): { holder: Holder; method: string } | undefined => {
  const lastDot = decoratorName.lastIndexOf('.');
  if (lastDot === -1) {
    return undefined;
  }
  const method = decoratorName.slice(lastDot + 1);
  const holder = world.holders.get(holderKey(filePath, decoratorName.slice(0, lastDot)));
  return holder === undefined || !HTTP_METHODS.has(method)
    ? undefined
    : { holder, method: method.toUpperCase() };
};

const emitRoute = (
  builder: FragmentBuilder,
  world: FastApiWorld,
  spec: RouteSpec,
  context: IndexingContext,
): void => {
  const fullPath = joinPath(world.prefixes.get(spec.holder.key) ?? '', spec.path);
  const identity = routeIdentity(spec.method, fullPath, 'brace');
  const routeNodeId = identity.nodeId;
  const knowledge = deterministicEnvelope(context, [spec.evidenceId], 'framework-convention');
  builder.addNode(
    {
      id: routeNodeId,
      category: 'application',
      type: 'api-endpoint',
      name: identity.name,
      route: identity.route,
      path: spec.filePath,
      knowledge,
    },
    spec.filePath,
  );
  for (const sourceId of [nodeIdFor(spec.holder), spec.handlerNodeId]) {
    builder.addEdge(
      {
        id: `fastapi:exposes:${sourceId}->${routeNodeId}`,
        type: 'EXPOSES',
        sourceId,
        targetId: routeNodeId,
        knowledge,
      },
      spec.filePath,
    );
  }
};

/** `@app.get("/x")` / `@router.post("/")` → an api-endpoint node plus its EXPOSES edges. */
export const addRoutes = ({ builder, graph, world, context }: RouteEmitInput): void => {
  for (const decorator of graph.decorators) {
    const spec = routeSpecOf(world, decorator.decoratorName, decorator.filePath);
    if (spec === undefined) {
      continue;
    }
    emitRoute(
      builder,
      world,
      {
        holder: spec.holder,
        method: spec.method,
        path: decorator.stringArguments[0] ?? '',
        handlerNodeId: decorator.targetNodeId,
        evidenceId: decorator.evidenceId,
        filePath: decorator.filePath,
      },
      context,
    );
  }
};
