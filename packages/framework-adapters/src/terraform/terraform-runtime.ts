import {
  CLOUD_RUN_ENV_RECEIVER,
  deterministicEnvelope,
  REFERENCE_RECEIVER,
  terraformNodeId,
  directoryOf,
} from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * The runtime layer over Terraform: which URL resolves to which process, and what that process is
 * actually given.
 *
 * `admin → NEWSLETTER_SERVICE_URL → frontend_service_urls.newsletter → _agg.newsletter → aggregator
 * container` was entirely present in the configuration and entirely absent from the graph. Every
 * hop below is a reference the adapter already recorded; what was missing was an edge type that
 * means "traffic goes this way", so nothing could be traversed and nothing could be checked.
 *
 * Nothing here is inferred. A URL node is emitted only for a block whose NAME says it holds a
 * service address, and every edge follows a reference written in the configuration.
 */

/** Block names that hold a service address. Read from the name, which is what the repository states. */
const URL_NAME = /(^|_)(service_)?urls?$|_service_url$|_url$|service_urls/i;

/** Block kinds whose value can be a service address and can be followed. */
const RESOLUTION_TYPES = new Set([
  'terraform-resource',
  'terraform-local',
  'terraform-output',
  'terraform-variable',
]);

/** Node types that terminate a resolution chain: something that actually runs. */
const RUNTIME_TYPES = new Set(['cloud-run-service', 'cloud-run-job']);

const nodesById = (graph: CodeGraph): ReadonlyMap<string, GraphNode> =>
  new Map(graph.nodes.map((node) => [String(node.id), node]));

/**
 * Resolve a referenced address to a node, trimming trailing attribute selectors.
 *
 * `local._agg.newsletter` names the `newsletter` key inside `local._agg`. The key is not a block, so
 * the address as written resolves to nothing — and that one unresolved lookup is the difference
 * between walking the chain to the aggregator and stopping at the local that pointed at it.
 */
const resolveAddress = (
  byId: ReadonlyMap<string, GraphNode>,
  directory: string,
  address: string,
): GraphNode | undefined => {
  const segments = address.split('.');
  for (let length = segments.length; length >= 2; length -= 1) {
    const found = byId.get(terraformNodeId(directory, segments.slice(0, length).join('.')));
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

const isUrlBlock = (node: GraphNode): boolean =>
  RESOLUTION_TYPES.has(node.type) && URL_NAME.test(node.name);

/**
 * Blocks whose value can BE a service address, and therefore whose references are routing.
 *
 * `provider "google" { project = var.project_id }` references a variable, and that is ordinary
 * configuration, not a hop traffic takes. Treating every block-to-block reference as a resolution
 * would fill the runtime layer with edges that mean nothing and make the one chain that matters
 * unfindable.
 */
const carriesAnAddress = (node: GraphNode): boolean =>
  node.type === 'terraform-local' ||
  node.type === 'terraform-output' ||
  node.type === 'terraform-variable' ||
  isUrlBlock(node);

/**
 * One `service-url` entry point per URL-shaped block.
 *
 * A separate node rather than a retyped block: the block is a Terraform fact and keeps its meaning,
 * while the URL is the thing a CALLER is configured with. Conflating them would make "what does the
 * frontend call" and "what does this local contain" the same question, and they are not.
 */
const emitUrlEntryPoints = (
  builder: FragmentBuilder,
  context: IndexingContext,
  graph: CodeGraph,
): ReadonlyMap<string, string> => {
  const urlNodeIdByBlock = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!isUrlBlock(node)) {
      continue;
    }
    const filePath = node.path ?? '';
    const urlId = `service-url:${node.name}`;
    builder.addNode(
      {
        id: urlId,
        category: 'infrastructure',
        type: 'service-url',
        name: node.name,
        ...(filePath === '' ? {} : { path: filePath }),
        knowledge: deterministicEnvelope(context, [...node.knowledge.evidenceIds], 'configuration'),
      },
      filePath,
    );
    builder.addEdge(
      {
        id: `resolves-to:${urlId}->${String(node.id)}`,
        type: 'RESOLVES_TO',
        sourceId: urlId,
        targetId: String(node.id),
        knowledge: deterministicEnvelope(context, [...node.knowledge.evidenceIds], 'configuration'),
      },
      filePath,
    );
    urlNodeIdByBlock.set(String(node.id), urlId);
  }
  return urlNodeIdByBlock;
};

/**
 * Follow the references a block states. A reference from one resolution block to another is a
 * RESOLUTION hop; a reference that lands on something deployable is where traffic ARRIVES.
 */
interface RoutingHop {
  readonly source: GraphNode;
  readonly target: GraphNode;
  /** True when the reference lands on something deployable — where traffic arrives. */
  readonly isArrival: boolean;
}

/** The routing hop one reference states, or undefined when the reference is not routing at all. */
const routingHop = (
  fact: CallFact,
  byId: ReadonlyMap<string, GraphNode>,
): RoutingHop | undefined => {
  if (fact.receiverName !== REFERENCE_RECEIVER || fact.enclosingSymbolNodeId === undefined) {
    return undefined;
  }
  const source = byId.get(fact.enclosingSymbolNodeId);
  const target = resolveAddress(byId, directoryOf(fact.filePath), fact.calleeName);
  if (source === undefined || target === undefined || !carriesAnAddress(source)) {
    return undefined;
  }
  const isArrival = RUNTIME_TYPES.has(target.type);
  return isArrival || RESOLUTION_TYPES.has(target.type) ? { source, target, isArrival } : undefined;
};

const emitResolutionEdges = (
  builder: FragmentBuilder,
  context: IndexingContext,
  graph: CodeGraph,
  byId: ReadonlyMap<string, GraphNode>,
): void => {
  for (const fact of graph.callFacts) {
    const hop = routingHop(fact, byId);
    if (hop === undefined) {
      continue;
    }
    const { source, target, isArrival } = hop;
    builder.addEdge(
      {
        id: `${isArrival ? 'routes-to' : 'resolves-to'}:${String(source.id)}->${String(target.id)}`,
        type: isArrival ? 'ROUTES_TO' : 'RESOLVES_TO',
        sourceId: String(source.id),
        targetId: String(target.id),
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'configuration'),
      },
      fact.filePath,
    );
  }
};

/**
 * A container per deployable, and the environment it is given.
 *
 * The container is where configuration lands, and it is the distinction that mattered: the plan
 * configured the service, production ran the container, and only the container's environment
 * decides whether the request succeeds.
 */
const groupEnvBindings = (graph: CodeGraph): ReadonlyMap<string, CallFact[]> => {
  const grouped = new Map<string, CallFact[]>();
  for (const fact of graph.callFacts) {
    if (fact.receiverName !== CLOUD_RUN_ENV_RECEIVER || fact.enclosingSymbolNodeId === undefined) {
      continue;
    }
    const existing = grouped.get(fact.enclosingSymbolNodeId) ?? [];
    existing.push(fact);
    grouped.set(fact.enclosingSymbolNodeId, existing);
  }
  return grouped;
};

interface EnvironmentEmit {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly byId: ReadonlyMap<string, GraphNode>;
  readonly containerId: string;
  readonly facts: readonly CallFact[];
}

/** The environment one container is given, as nodes and RECEIVES_ENV edges. */
const emitEnvironment = ({ builder, context, byId, containerId, facts }: EnvironmentEmit): void => {
  for (const fact of facts) {
    const envName = fact.stringArguments[0];
    if (envName === undefined) {
      continue;
    }
    const envId = `env:${envName}`;
    const envelope = deterministicEnvelope(context, [fact.evidenceId], 'configuration');
    if (byId.get(envId) === undefined) {
      builder.addNode(
        {
          id: envId,
          category: 'infrastructure',
          type: 'environment-variable',
          name: envName,
          path: fact.filePath,
          knowledge: envelope,
        },
        fact.filePath,
      );
    }
    builder.addEdge(
      {
        id: `receives-env:${containerId}->${envId}`,
        type: 'RECEIVES_ENV',
        sourceId: containerId,
        targetId: envId,
        knowledge: envelope,
      },
      fact.filePath,
    );
  }
};

const emitContainersAndEnvironment = (
  builder: FragmentBuilder,
  context: IndexingContext,
  graph: CodeGraph,
  byId: ReadonlyMap<string, GraphNode>,
): void => {
  const envByService = groupEnvBindings(graph);
  for (const node of graph.nodes) {
    if (!RUNTIME_TYPES.has(node.type)) {
      continue;
    }
    const filePath = node.path ?? '';
    const containerId = `container:${String(node.id)}`;
    const envelope = deterministicEnvelope(
      context,
      [...node.knowledge.evidenceIds],
      'configuration',
    );
    builder.addNode(
      {
        id: containerId,
        category: 'infrastructure',
        type: 'container',
        name: `${node.name} container`,
        ...(filePath === '' ? {} : { path: filePath }),
        knowledge: envelope,
      },
      filePath,
    );
    builder.addEdge(
      {
        id: `contains:${String(node.id)}->${containerId}`,
        type: 'CONTAINS',
        sourceId: String(node.id),
        targetId: containerId,
        knowledge: envelope,
      },
      filePath,
    );
    emitEnvironment({
      builder,
      context,
      byId,
      containerId,
      facts: envByService.get(String(node.id)) ?? [],
    });
  }
};

export const enrichTerraformRuntime = (
  builder: FragmentBuilder,
  context: IndexingContext,
  graph: CodeGraph,
): void => {
  const byId = nodesById(graph);
  emitUrlEntryPoints(builder, context, graph);
  emitResolutionEdges(builder, context, graph, byId);
  emitContainersAndEnvironment(builder, context, graph, byId);
};
