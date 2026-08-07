import type { GraphEdge, KnowledgeGraph, NodeId } from '@impactgraph/domain';

/**
 * Repository attribution, derived at ANSWER time from the roster's relative prefixes (item 6).
 *
 * Multi-root indexing rebases every registered repository under its path relative to the
 * workspace root, so the owning repository of any node is recoverable from its path alone —
 * nothing is persisted on the node, for the same reason index freshness is derived: a stored
 * owner would go stale the moment the roster changes, the file list that produced it cannot.
 */

/** The workspace root's display name — the same one the roster and coverage reports use. */
export const WORKSPACE_ROOT_REPOSITORY = '(workspace root)';

export interface RepositoryPrefix {
  readonly name: string;
  /** Workspace-relative path prefix of the registered repository (never the root itself). */
  readonly prefix: string;
}

/**
 * Attribution table from roster-shaped entries (`name` + workspace-relative `path`).
 * Entries without a path (the workspace root, absent members) attribute nothing; deepest
 * prefix wins so a repository nested inside another is not swallowed by its parent.
 */
export const attributionPrefixes = (
  repositories: readonly { readonly name: string; readonly path?: string | undefined }[],
): readonly RepositoryPrefix[] =>
  repositories
    .filter(
      (entry): entry is { name: string; path: string } =>
        entry.path !== undefined &&
        entry.path.length > 0 &&
        entry.name !== WORKSPACE_ROOT_REPOSITORY,
    )
    .map((entry) => ({ name: entry.name, prefix: entry.path }))
    .sort((a, b) => b.prefix.length - a.prefix.length || a.name.localeCompare(b.name));

/**
 * The registered repository that owns a path. A path outside every prefix — and a node with no
 * path at all (workspace nodes, derived context nodes) — belongs to the workspace root: the
 * root is the repository the user opened, not a fallback guess.
 */
export const owningRepository = (
  prefixes: readonly RepositoryPrefix[],
  path: string | undefined,
): string => {
  if (path !== undefined) {
    for (const entry of prefixes) {
      if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
        return entry.name;
      }
    }
  }
  return WORKSPACE_ROOT_REPOSITORY;
};

export interface RepositoryBreakdownEntry {
  readonly name: string;
  readonly nodeCount: number;
  readonly fileCount: number;
}

/** Node and file counts per repository: the root first, then registered members by name. */
export const repositoryBreakdown = (
  graph: KnowledgeGraph,
  prefixes: readonly RepositoryPrefix[],
): readonly RepositoryBreakdownEntry[] => {
  const nodeCounts = new Map<string, number>([[WORKSPACE_ROOT_REPOSITORY, 0]]);
  const fileCounts = new Map<string, number>([[WORKSPACE_ROOT_REPOSITORY, 0]]);
  for (const entry of prefixes) {
    nodeCounts.set(entry.name, 0);
    fileCounts.set(entry.name, 0);
  }
  for (const node of graph.nodes.values()) {
    const owner = owningRepository(prefixes, node.path);
    nodeCounts.set(owner, (nodeCounts.get(owner) ?? 0) + 1);
    if (node.type === 'file') {
      fileCounts.set(owner, (fileCounts.get(owner) ?? 0) + 1);
    }
  }
  const members = [...nodeCounts.keys()]
    .filter((name) => name !== WORKSPACE_ROOT_REPOSITORY)
    .sort((a, b) => a.localeCompare(b));
  return [WORKSPACE_ROOT_REPOSITORY, ...members].map((name) => ({
    name,
    nodeCount: nodeCounts.get(name) ?? 0,
    fileCount: fileCounts.get(name) ?? 0,
  }));
};

export interface CrossRepositoryEdgeSample {
  readonly from: string;
  readonly to: string;
  readonly type: string;
  /** The two owning repositories, source first. */
  readonly repositories: readonly [string, string];
}

export interface CrossRepositoryEdgeReport {
  readonly count: number;
  /** Bounded, deterministic sample (edge-id order) — the full set stays queryable per edge. */
  readonly samples: readonly CrossRepositoryEdgeSample[];
}

const DEFAULT_SAMPLE_LIMIT = 10;

/** Edges whose endpoints belong to different registered repositories. */
export const crossRepositoryEdges = (
  graph: KnowledgeGraph,
  prefixes: readonly RepositoryPrefix[],
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
): CrossRepositoryEdgeReport => {
  const crossing: { edge: GraphEdge; from: string; to: string }[] = [];
  for (const edge of graph.edges.values()) {
    const from = owningRepository(prefixes, graph.nodes.get(edge.sourceId)?.path);
    const to = owningRepository(prefixes, graph.nodes.get(edge.targetId)?.path);
    if (from !== to) {
      crossing.push({ edge, from, to });
    }
  }
  crossing.sort((a, b) => a.edge.id.localeCompare(b.edge.id));
  return {
    count: crossing.length,
    samples: crossing.slice(0, sampleLimit).map(({ edge, from, to }) => ({
      from: edge.sourceId,
      to: edge.targetId,
      type: edge.type,
      repositories: [from, to],
    })),
  };
};

/** Distinct components per owning repository — "which repositories does this change span". */
export const componentsByRepository = (
  nodeIds: readonly string[],
  graph: KnowledgeGraph,
  prefixes: readonly RepositoryPrefix[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const nodeId of new Set(nodeIds)) {
    const node = graph.nodes.get(nodeId as NodeId);
    const owner = owningRepository(prefixes, node?.path);
    counts[owner] = (counts[owner] ?? 0) + 1;
  }
  return counts;
};
