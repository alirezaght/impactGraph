import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// PRD §C13, "Terraform → Cloud Run" and "… ↔ Pub/Sub": a Cloud Run service named `deals-api` and a
// package named `deals-api` are the same thing seen from two stacks; so are a GCP topic named
// `deal-events` and the topic the application publishes to.
//
// Unlike the Terraform adapter's own edges, these are NOT parsed facts — nothing in the `.tf` file
// names the package, and nothing in the code names the resource. They are name correspondences,
// so three rules keep them defensible:
//
// * The declared name must be a literal the configuration states. A resource whose `name`
//   interpolates has no name this adapter is allowed to know, and is skipped entirely.
// * Equality must be exact. No case folding, no prefix or suffix stripping, no fuzzy distance.
// * Only type pairs that mean the same thing are considered, and a code node is never matched
//   against a resource of an unrelated kind.
//
// Provenance is `framework-convention` — the deterministic category for "derived from a platform
// convention" — never `static-analysis`, and evidence from both sides is attached so the claim is
// reviewable rather than merely plausible.

/** Infrastructure types that carry a GCP-visible name worth correlating. */
export const CORRELATABLE_INFRA_TYPES = new Set([
  'cloud-run-service',
  'cloud-run-job',
  'pubsub-topic',
  'pubsub-subscription',
]);

/** Which code-side node types may correspond to each infrastructure type. */
const CODE_TYPES_FOR: Readonly<Record<string, readonly string[]>> = {
  'cloud-run-service': ['application', 'service', 'package'],
  'cloud-run-job': ['application', 'service', 'package', 'job'],
  'pubsub-topic': ['topic'],
  'pubsub-subscription': ['subscription'],
};

export const CORRELATABLE_CODE_TYPES = new Set(Object.values(CODE_TYPES_FOR).flat());

/**
 * The name the Terraform configuration literally declared, or undefined.
 *
 * The Terraform adapter names a resource node by its `name` attribute when that attribute is a
 * plain literal, and falls back to the resource's address (which is always the tail of the node
 * id) when it interpolates. A name that is not the id's tail is therefore a declared literal —
 * and a fallback name is the adapter saying "I do not know what this is called", which is exactly
 * the case that must never be correlated.
 */
export const declaredInfrastructureName = (node: GraphNode): string | undefined => {
  if (node.id.endsWith(`:${node.name}`) || node.id.endsWith(`/${node.name}`)) {
    return undefined;
  }
  return node.name.trim() === '' ? undefined : node.name;
};

const codeNodesByName = (graph: CodeGraph): ReadonlyMap<string, GraphNode[]> => {
  const byName = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!CORRELATABLE_CODE_TYPES.has(node.type)) {
      continue;
    }
    const list = byName.get(node.name) ?? [];
    list.push(node);
    byName.set(node.name, list);
  }
  return byName;
};

interface DeployLink {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly code: GraphNode;
  readonly infrastructure: GraphNode;
}

const linkDeployment = (input: DeployLink): void => {
  const { builder, context, code, infrastructure } = input;
  builder.addEdge(
    {
      id: `cross-stack:deployed-as:${code.id}->${infrastructure.id}`,
      type: 'DEPLOYED_AS',
      sourceId: code.id,
      targetId: infrastructure.id,
      knowledge: deterministicEnvelope(
        context,
        [...code.knowledge.evidenceIds, ...infrastructure.knowledge.evidenceIds],
        'framework-convention',
      ),
    },
    infrastructure.path ?? 'cross-stack',
  );
};

/** One correspondence: the code component, and the resource the configuration deploys it as. */
export interface DeployedPair {
  readonly code: GraphNode;
  readonly infrastructure: GraphNode;
}

/**
 * Correlate declared infrastructure resources with the code they deploy. Returns the pairs it
 * found, so the caller can report an honest detection reason — and so `cloud-run-env.ts` can reuse
 * exactly this correspondence instead of inventing a second way to tie a service to its code.
 */
export const linkInfrastructure = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): readonly DeployedPair[] => {
  const byName = codeNodesByName(graph);
  const matched: DeployedPair[] = [];
  for (const infrastructure of graph.nodes) {
    const name = CORRELATABLE_INFRA_TYPES.has(infrastructure.type)
      ? declaredInfrastructureName(infrastructure)
      : undefined;
    const allowed = CODE_TYPES_FOR[infrastructure.type] ?? [];
    const candidates = (name === undefined ? [] : (byName.get(name) ?? [])).filter((code) =>
      allowed.includes(code.type),
    );
    for (const code of candidates) {
      linkDeployment({ builder, context, code, infrastructure });
      matched.push({ code, infrastructure });
    }
  }
  return matched;
};
