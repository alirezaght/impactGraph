import { matchesGlob } from '@impactgraph/application';
import { createKnowledgeGraph, createGraphEdge, createGraphNode } from '@impactgraph/domain';

import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

/**
 * Bounded contexts declared in `.impactgraph/architecture.yml` emitted as graph knowledge
 * (item 6): a `bounded-context` node per declared context and a `BELONGS_TO_CONTEXT` edge per
 * member, derived at READ time exactly like the rest of the overlay — the deterministic graph
 * is never mutated and nothing is persisted, so a reindex can never lose a declared boundary.
 *
 * Provenance is `configuration`: the recorded fact is "the committed configuration declares
 * this context over these paths", read deterministically from the file — the same category a
 * `package` node gets from package.json. Whether the assignment is CORRECT remains the
 * overlay's §Z5 business (hand-written YAML resolves as human-confirmed there).
 */

export interface ContextEmissionMeta {
  readonly snapshotId: string;
  readonly createdAt: string;
}

/**
 * Membership is computed at the structural-unit level: `file` and `package` nodes whose path
 * matches the context's globs (or a component assignment naming the context). Symbols and other
 * fine-grained nodes inherit through CONTAINS — emitting an edge per symbol would multiply the
 * edge count without adding a single new fact.
 */
const MEMBER_NODE_TYPES: ReadonlySet<string> = new Set(['file', 'package']);

type ContextEntries = NonNullable<ArchitectureConfigDto['contexts']>;

const memberGlobs = (
  architecture: ArchitectureConfigDto,
  context: ContextEntries[number],
): readonly string[] => [
  ...context.paths,
  ...(architecture.components ?? [])
    .filter((entry) => entry.context === context.name)
    .map((entry) => entry.path),
];

/** Member nodes per declared context, in declaration order. */
export const configuredContextMembers = (
  graph: KnowledgeGraph,
  architecture: ArchitectureConfigDto,
): ReadonlyMap<string, readonly GraphNode[]> => {
  const members = new Map<string, readonly GraphNode[]>();
  const candidates = [...graph.nodes.values()].filter(
    (node) => MEMBER_NODE_TYPES.has(node.type) && node.path !== undefined,
  );
  for (const context of architecture.contexts ?? []) {
    const globs = memberGlobs(architecture, context);
    members.set(
      context.name,
      candidates.filter((node) =>
        globs.some((glob) => node.path !== undefined && matchesGlob(node.path, glob)),
      ),
    );
  }
  return members;
};

const envelopeFor = (contextName: string, meta: ContextEmissionMeta) => ({
  provenance: 'configuration',
  evidenceIds: [`evidence:configuration:.impactgraph/architecture.yml#context:${contextName}`],
  confidence: {
    value: 1,
    signals: [
      {
        type: 'direct-observation',
        contribution: 1,
        description: `context '${contextName}' declared in .impactgraph/architecture.yml`,
      },
    ],
  },
  createdAt: meta.createdAt,
  repositorySnapshotId: meta.snapshotId,
  analysisRunId: `overlay:${meta.snapshotId}`,
});

export const contextNodeId = (contextName: string): string => `bounded-context:${contextName}`;

const contextNode = (contextName: string, meta: ContextEmissionMeta): GraphNode | undefined => {
  const created = createGraphNode({
    id: contextNodeId(contextName),
    category: 'domain',
    type: 'bounded-context',
    name: contextName,
    knowledge: envelopeFor(contextName, meta),
  });
  return created.ok ? created.value : undefined;
};

const membershipEdge = (
  member: GraphNode,
  contextName: string,
  meta: ContextEmissionMeta,
): GraphEdge | undefined => {
  const created = createGraphEdge({
    id: `edge:belongs-to-context:${member.id}:${contextName}`,
    type: 'BELONGS_TO_CONTEXT',
    sourceId: member.id,
    targetId: contextNodeId(contextName),
    knowledge: envelopeFor(contextName, meta),
  });
  return created.ok ? created.value : undefined;
};

/**
 * The read-time graph with the declared bounded contexts in it. No contexts configured — or a
 * derived id colliding with an existing one — returns the input graph unchanged: augmentation
 * must never make a valid graph unreadable.
 */
export const withConfiguredContexts = (
  graph: KnowledgeGraph,
  architecture: ArchitectureConfigDto,
  meta: ContextEmissionMeta,
): KnowledgeGraph => {
  const membership = configuredContextMembers(graph, architecture);
  if (membership.size === 0) {
    return graph;
  }
  const addedNodes: GraphNode[] = [];
  const addedEdges: GraphEdge[] = [];
  for (const [contextName, members] of membership) {
    const node = contextNode(contextName, meta);
    if (node === undefined || graph.nodes.has(node.id)) {
      continue;
    }
    addedNodes.push(node);
    for (const member of members) {
      const edge = membershipEdge(member, contextName, meta);
      if (edge !== undefined && !graph.edges.has(edge.id)) {
        addedEdges.push(edge);
      }
    }
  }
  if (addedNodes.length === 0) {
    return graph;
  }
  const augmented = createKnowledgeGraph(
    [...graph.nodes.values(), ...addedNodes],
    [...graph.edges.values(), ...addedEdges],
  );
  return augmented.ok ? augmented.value : graph;
};
