import {
  CLOUD_RUN_ENV_RECEIVER,
  deterministicEnvelope,
  directoryOf,
  PUBSUB_ENV_RECEIVER,
  terraformNodeId,
  unresolvedNameKind,
} from '@impactgraph/language-adapters';

import { declaredInfrastructureName } from './infrastructure-links.js';

import type { DeployedPair } from './infrastructure-links.js';
import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type {
  CallFact,
  FragmentBuilder,
  IndexingContext,
  PubSubResourceKind,
} from '@impactgraph/language-adapters';

// PRD §C13 — "Cloud Run env becomes `process.env`". The one platform convention that lets a
// service's `process.env.DEAL_EVENTS_TOPIC` name a real topic without anybody guessing.
//
// Both halves are stated, each in its own file:
//
//   infra/main.tf   env { name = "DEAL_EVENTS_TOPIC" value = google_pubsub_topic.deal_events.name }
//   worker/…/x.ts   pubsub.topic(process.env.DEAL_EVENTS_TOPIC).publishMessage(…)
//
// Neither file names the other. What joins them is the deployment: this code runs in THAT service,
// so that service's environment is this code's environment. Four conditions, all required, none of
// them a similarity measure:
//
// 1. The environment variable name is LITERALLY EQUAL on both sides. No case folding, no prefix
//    stripping, no "looks like a topic".
// 2. The Terraform `value` REFERENCES a `google_pubsub_topic`/`google_pubsub_subscription` this
//    configuration declares, and that resource's `name` is a literal. A value that is a plain
//    string, an interpolation, or a reference to anything else supplies nothing.
// 3. The Cloud Run service or job is tied to the code by the EXISTING correspondence in
//    `infrastructure-links.ts` (exact declared-name equality against a package/application/service/
//    job node) — reused, not re-derived — and the reading file is one that code node contains.
// 4. The two sides agree on kind: a topic reference answers a topic read, never a subscription's.
//
// Anything else resolves to nothing. Provenance is `framework-convention` with evidence from both
// sides, exactly like every other correspondence here — the convention is real, but it is a
// convention, and a reviewer must be able to open both lines and disagree.

const CLOUD_RUN_TYPES = new Set(['cloud-run-service', 'cloud-run-job']);

const RESOURCE_KIND: ReadonlyMap<string, PubSubResourceKind> = new Map([
  ['pubsub-topic', 'topic'],
  ['pubsub-subscription', 'subscription'],
]);

const EDGE_TYPE: ReadonlyMap<PubSubResourceKind, string> = new Map([
  ['topic', 'PUBLISHES'],
  ['subscription', 'SUBSCRIBES_TO'],
]);

/** One `env { name = … value = <resource> }` resolved against the resources it references. */
interface EnvBinding {
  readonly envName: string;
  readonly kind: PubSubResourceKind;
  /** The literal name the resource declares — the only string that may become a node. */
  readonly resourceName: string;
  readonly resourceNodeId: string;
  readonly evidenceId: string;
}

/** Cloud Run node id → the environment bindings its configuration states. */
type BindingsByService = ReadonlyMap<string, readonly EnvBinding[]>;

const bindingFor = (
  fact: CallFact,
  nodes: ReadonlyMap<string, GraphNode>,
): EnvBinding | undefined => {
  const envName = fact.stringArguments[0];
  const resourceNodeId = terraformNodeId(directoryOf(fact.filePath), fact.calleeName);
  const resource = nodes.get(resourceNodeId);
  const kind = resource === undefined ? undefined : RESOURCE_KIND.get(resource.type);
  const resourceName = resource === undefined ? undefined : declaredInfrastructureName(resource);
  if (envName === undefined || kind === undefined || resourceName === undefined) {
    return undefined;
  }
  return { envName, kind, resourceName, resourceNodeId, evidenceId: fact.evidenceId };
};

const environmentBindings = (graph: CodeGraph): BindingsByService => {
  const nodes = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const byService = new Map<string, EnvBinding[]>();
  for (const fact of graph.callFacts) {
    const service = fact.enclosingSymbolNodeId;
    const owner = service === undefined ? undefined : nodes.get(service);
    if (fact.receiverName !== CLOUD_RUN_ENV_RECEIVER || owner === undefined) {
      continue;
    }
    const binding = CLOUD_RUN_TYPES.has(owner.type) ? bindingFor(fact, nodes) : undefined;
    if (binding !== undefined && service !== undefined) {
      byService.set(service, [...(byService.get(service) ?? []), binding]);
    }
  }
  return byService;
};

/** File path → the Cloud Run resources whose deployed code contains that file. */
const servicesByFile = (
  graph: CodeGraph,
  deployments: readonly DeployedPair[],
): ReadonlyMap<string, readonly string[]> => {
  const deployed = new Map(
    deployments
      .filter((pair) => CLOUD_RUN_TYPES.has(pair.infrastructure.type))
      .map((pair) => [String(pair.code.id), String(pair.infrastructure.id)]),
  );
  const byFile = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const service = edge.type === 'CONTAINS' ? deployed.get(edge.sourceId) : undefined;
    if (service === undefined || !edge.targetId.startsWith('file:')) {
      continue;
    }
    const filePath = edge.targetId.slice('file:'.length);
    byFile.set(filePath, [...(byFile.get(filePath) ?? []), service]);
  }
  return byFile;
};

interface Linker {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly bindings: BindingsByService;
  readonly services: ReadonlyMap<string, readonly string[]>;
  readonly existingNodes: ReadonlySet<string>;
  readonly emitted: Set<string>;
}

const link = (linker: Linker, fact: CallFact, binding: EnvBinding): void => {
  const { builder, context, existingNodes, emitted } = linker;
  const sourceId = fact.enclosingSymbolNodeId ?? '';
  const nodeId = `${binding.kind}:${binding.resourceName}`;
  const knowledge = deterministicEnvelope(
    context,
    [fact.evidenceId, binding.evidenceId],
    'framework-convention',
  );
  if (!existingNodes.has(nodeId) && !emitted.has(nodeId)) {
    emitted.add(nodeId);
    builder.addNode(
      {
        id: nodeId,
        category: 'integration',
        type: binding.kind,
        name: binding.resourceName,
        path: fact.filePath,
        knowledge,
      },
      fact.filePath,
    );
    // The node exists only because this correspondence produced it, so its DEPLOYED_AS link would
    // otherwise be missing: `infrastructure-links.ts` correlates the nodes the graph ALREADY had.
    builder.addEdge(
      {
        id: `cross-stack:deployed-as:${nodeId}->${binding.resourceNodeId}`,
        type: 'DEPLOYED_AS',
        sourceId: nodeId,
        targetId: binding.resourceNodeId,
        knowledge,
      },
      fact.filePath,
    );
  }
  const type = EDGE_TYPE.get(binding.kind) ?? 'USES';
  const edgeId = `cross-stack:${type.toLowerCase()}:${sourceId}->${nodeId}`;
  if (!emitted.has(edgeId)) {
    emitted.add(edgeId);
    builder.addEdge({ id: edgeId, type, sourceId, targetId: nodeId, knowledge }, fact.filePath);
  }
};

const linkOne = (linker: Linker, fact: CallFact): void => {
  const kind = unresolvedNameKind(fact.stringArguments);
  if (kind === undefined || fact.enclosingSymbolNodeId === undefined) {
    return;
  }
  for (const service of linker.services.get(fact.filePath) ?? []) {
    for (const binding of linker.bindings.get(service) ?? []) {
      if (binding.envName === fact.calleeName && binding.kind === kind) {
        link(linker, fact, binding);
      }
    }
  }
};

/**
 * Join code that reads an environment variable to the Pub/Sub resource the deployment sets that
 * variable to. Emits nothing at all unless both halves are literally stated (see the rules above).
 */
export const linkCloudRunEnvironment = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
  deployments: readonly DeployedPair[],
): void => {
  const linker: Linker = {
    builder,
    context,
    bindings: environmentBindings(graph),
    services: servicesByFile(graph, deployments),
    existingNodes: new Set(graph.nodes.map((node) => String(node.id))),
    emitted: new Set<string>(),
  };
  for (const fact of graph.callFacts) {
    if (fact.receiverName === PUBSUB_ENV_RECEIVER) {
      linkOne(linker, fact);
    }
  }
};
