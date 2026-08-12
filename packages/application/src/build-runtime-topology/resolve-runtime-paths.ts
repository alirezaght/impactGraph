import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  NodeId,
  RuntimeHop,
  RuntimeHopKind,
  RuntimePath,
} from '@impactgraph/domain';

/**
 * Walk the deployment graph from a configured URL to the code that actually answers it.
 *
 * Source dependencies say `admin → newsletter-service`. Production said
 * `admin → NEWSLETTER_SERVICE_URL → frontend_service_urls.newsletter → _agg.newsletter →
 * aggregator container`. Every hop was in the repository; none of them was in the graph, so no
 * query could reach the aggregator and no analysis could notice the aggregator was never given the
 * configuration the plan added to the service.
 */

/** Node type → the hop kind it plays. Anything absent is not a hop and stops the walk. */
const HOP_KIND_BY_TYPE: Readonly<Record<string, RuntimeHopKind>> = {
  'service-url': 'configured-url',
  'environment-variable': 'configured-url',
  'terraform-local': 'resolution',
  'terraform-output': 'resolution',
  'terraform-variable': 'resolution',
  'terraform-resource': 'runtime-resource',
  'cloud-run-service': 'runtime-resource',
  'cloud-run-job': 'runtime-resource',
  container: 'process',
  'runtime-process': 'process',
  service: 'handler',
  application: 'handler',
  handler: 'handler',
  controller: 'handler',
  'api-endpoint': 'handler',
};

/** Edge types the walk may follow, in the direction traffic and values travel. */
const TRAVERSABLE = new Set(['RESOLVES_TO', 'ROUTES_TO', 'RUNS_IN', 'DEPLOYED_AS', 'CONTAINS']);

/** Bounds the walk. A chain longer than this is a modelling problem, not a deployment. */
const MAX_HOPS = 12;

const edgesFrom = (graph: KnowledgeGraph, id: NodeId): readonly GraphEdge[] =>
  (graph.outgoing.get(id) ?? [])
    .map((edgeId: EdgeId) => graph.edges.get(edgeId))
    .filter((edge): edge is GraphEdge => edge !== undefined && TRAVERSABLE.has(edge.type));

const hopOf = (node: GraphNode, viaRelation?: string): RuntimeHop | undefined => {
  const kind = HOP_KIND_BY_TYPE[node.type];
  if (kind === undefined) {
    return undefined;
  }
  return {
    kind,
    nodeId: String(node.id),
    name: node.name,
    ...(viaRelation === undefined ? {} : { viaRelation }),
    evidenceIds: [...node.knowledge.evidenceIds],
  };
};

/**
 * Deepest-first, deterministic: at each step the outgoing edges are already sorted by the graph's
 * adjacency index, and the first traversable edge is taken. A branch point is recorded as an
 * incomplete path rather than being silently collapsed to one arm — "traffic could go two ways and
 * we do not know which" is a real answer, and picking one would fabricate certainty.
 */
const walk = (
  graph: KnowledgeGraph,
  start: GraphNode,
): { hops: RuntimeHop[]; incompleteReason?: string } => {
  const hops: RuntimeHop[] = [];
  const seen = new Set<string>();
  let current: GraphNode | undefined = start;
  let via: string | undefined;
  while (current !== undefined && hops.length < MAX_HOPS) {
    if (seen.has(String(current.id))) {
      return { hops, incompleteReason: 'the deployment graph contains a cycle at this point' };
    }
    seen.add(String(current.id));
    const hop = hopOf(current, via);
    if (hop === undefined) {
      return {
        hops,
        incompleteReason: `the chain reaches '${current.name}', which is not a runtime hop`,
      };
    }
    hops.push(hop);
    const next = edgesFrom(graph, current.id);
    if (next.length === 0) {
      return hops.some((entry) => entry.kind === 'handler')
        ? { hops }
        : {
            hops,
            incompleteReason: `the chain stops at '${current.name}' before reaching a handler`,
          };
    }
    if (next.length > 1) {
      return {
        hops,
        incompleteReason: `'${current.name}' routes to ${String(next.length)} targets and the repository does not state which serves this traffic`,
      };
    }
    const edge = next[0] as GraphEdge;
    via = edge.type;
    current = graph.nodes.get(edge.targetId);
  }
  return hops.length >= MAX_HOPS
    ? { hops, incompleteReason: 'the chain exceeded the traversal budget' }
    : { hops };
};

/** Nodes a runtime path may start from: a URL a caller is configured with. */
const START_TYPES = new Set(['service-url', 'environment-variable']);

export interface ResolveRuntimePathsInput {
  readonly graph: KnowledgeGraph;
  /** Restrict to URLs whose name matches, e.g. only those a plan touches. Absent means all. */
  readonly urlNamePattern?: RegExp;
  readonly environment?: string;
}

export const resolveRuntimePaths = (input: ResolveRuntimePathsInput): readonly RuntimePath[] => {
  const paths: RuntimePath[] = [];
  const starts = [...input.graph.nodes.values()]
    .filter((node) => START_TYPES.has(node.type))
    .filter((node) => input.urlNamePattern?.test(node.name) ?? true)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const start of starts) {
    const { hops, incompleteReason } = walk(input.graph, start);
    // A single-hop "path" is just the URL itself: nothing was resolved, so there is nothing to say.
    if (hops.length < 2) {
      continue;
    }
    paths.push({
      id: `runtime-path:${String(start.id)}`,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      hops,
      ...(incompleteReason === undefined ? {} : { incompleteReason }),
    });
  }
  return paths;
};

/** Environment variable names a process node is given, read from its RECEIVES_ENV edges. */
export const configuredNamesByProcess = (
  graph: KnowledgeGraph,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const byProcess = new Map<string, Set<string>>();
  for (const edge of graph.edges.values()) {
    if (edge.type !== 'RECEIVES_ENV') {
      continue;
    }
    const target = graph.nodes.get(edge.targetId);
    if (target === undefined) {
      continue;
    }
    const existing = byProcess.get(edge.sourceId) ?? new Set<string>();
    existing.add(target.name);
    byProcess.set(edge.sourceId, existing);
  }
  return byProcess;
};
