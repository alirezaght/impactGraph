import {
  deterministicEnvelope,
  directoryOf,
  REFERENCE_RECEIVER,
  terraformNodeId,
} from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// Resolving the references the Terraform language adapter recorded. Every edge here comes from a
// reference written in the source — `topic = google_pubsub_topic.deal_events.name` names a
// resource — so these are parsed configuration facts, not name correspondences. Provenance stays
// `configuration`; nothing about resolving an address is a framework convention.

/** A Terraform address resolves inside its own directory: a directory IS a module. */
const targetIdOf = (fact: CallFact): string =>
  terraformNodeId(directoryOf(fact.filePath), fact.calleeName);

/**
 * A Pub/Sub subscription that names a topic genuinely subscribes to it — the resource types say
 * so. Every other reference is a dependency and nothing more specific is claimed.
 */
const edgeTypeFor = (source: GraphNode, target: GraphNode): 'SUBSCRIBES_TO' | 'DEPENDS_ON' =>
  source.type === 'pubsub-subscription' && target.type === 'pubsub-topic'
    ? 'SUBSCRIBES_TO'
    : 'DEPENDS_ON';

const INSTANCE_SUFFIX = /\[\d+\]$/;

/**
 * Instances of a `count`-expanded block, keyed by the address without the index.
 *
 * `google_pubsub_topic.shard` with `count = 3` is indexed as three nodes, but the source refers to
 * the set by its bare address (`google_pubsub_topic.shard[*].id`, or the whole list). Pointing the
 * edge at every instance is what the configuration actually says — and it is a lookup over indexed
 * node ids, not an evaluation of the reference expression (PRD §35).
 */
const instancesByBaseId = (graph: CodeGraph): ReadonlyMap<string, GraphNode[]> => {
  const byBase = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const id = String(node.id);
    if (INSTANCE_SUFFIX.test(id)) {
      const base = id.replace(INSTANCE_SUFFIX, '');
      byBase.set(base, [...(byBase.get(base) ?? []), node]);
    }
  }
  return byBase;
};

interface ReferenceLink {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly fact: CallFact;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly instances: ReadonlyMap<string, GraphNode[]>;
}

const linkReference = (input: ReferenceLink): void => {
  const { builder, context, fact, nodes, instances } = input;
  const sourceId = fact.enclosingSymbolNodeId;
  const targetId = targetIdOf(fact);
  const source = sourceId === undefined ? undefined : nodes.get(sourceId);
  const exact = nodes.get(targetId);
  const targets = exact === undefined ? (instances.get(targetId) ?? []) : [exact];
  if (targets.length === 0) {
    builder.warn(
      fact.filePath,
      `reference '${fact.calleeName}' names nothing declared in this Terraform module`,
    );
    return;
  }
  if (source === undefined) {
    return;
  }
  for (const target of targets) {
    addReferenceEdge({ builder, context, fact }, source, target);
  }
};

const addReferenceEdge = (
  input: Pick<ReferenceLink, 'builder' | 'context' | 'fact'>,
  source: GraphNode,
  target: GraphNode,
): void => {
  if (source.id === target.id) {
    return;
  }
  const edgeType = edgeTypeFor(source, target);
  input.builder.addEdge(
    {
      id: `terraform:${edgeType.toLowerCase()}:${source.id}->${String(target.id)}`,
      type: edgeType,
      sourceId: source.id,
      targetId: String(target.id),
      knowledge: deterministicEnvelope(input.context, [input.fact.evidenceId], 'configuration'),
    },
    input.fact.filePath,
  );
};

/** Turn every recorded reference into an edge, or into a warning when it resolves to nothing. */
export const linkTerraformReferences = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const nodes = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const instances = instancesByBaseId(graph);
  const seen = new Set<string>();
  for (const fact of graph.callFacts) {
    const key = `${fact.enclosingSymbolNodeId ?? ''}->${targetIdOf(fact)}`;
    if (fact.receiverName !== REFERENCE_RECEIVER || seen.has(key)) {
      continue;
    }
    seen.add(key);
    linkReference({ builder, context, fact, nodes, instances });
  }
};
