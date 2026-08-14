import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Top-level container identity for the exact-collision guard (concept-matching). "Container"
// means the package, workspace, or repository directory a node lives in — the unit that decides
// whether two same-named symbols are one component or a coincidence. Deterministic and cheap by
// construction: derived from paths against the graph's declared package/workspace nodes, with no
// traversal, and the roots are computed once per graph scan.

/** Node types whose path declares a container directory. */
const CONTAINER_NODE_TYPES = new Set(['package', 'workspace']);

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const directoryOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

/** A manifest file's container is its directory; a node whose path IS a directory keeps it. */
const hasExtension = (name: string): boolean => /\.[A-Za-z0-9]{1,8}$/.test(name);

/**
 * The directories owned by declared package/workspace nodes, longest first so the most specific
 * container wins prefix matching. The repository root ('') is excluded — every node nests under
 * it, so it can never tell two containers apart.
 */
export const containerRoots = (graph: KnowledgeGraph): readonly string[] => {
  const roots = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (!CONTAINER_NODE_TYPES.has(node.type) || node.path === undefined) {
      continue;
    }
    const root = hasExtension(basename(node.path)) ? directoryOf(node.path) : node.path;
    if (root !== '') {
      roots.add(root);
    }
  }
  return [...roots].sort((a, b) => b.length - a.length || a.localeCompare(b));
};

/**
 * The top-level container a node lives in, or undefined when the graph cannot say (no path).
 *
 * A declared package root that prefixes the path wins. Without one, the first path segment stands
 * in: in a multi-repository workspace each repository is a top-level directory, so the segment IS
 * the container. The fallback deliberately errs toward "same container" — in a monorepo without
 * indexed package nodes every path starts with the same segment, and an indeterminate container
 * must keep today's behavior rather than invent a collision.
 */
export const containerOf = (node: GraphNode, roots: readonly string[]): string | undefined => {
  const path = node.path;
  if (path === undefined) {
    return undefined;
  }
  const root = roots.find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
  if (root !== undefined) {
    return root;
  }
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};
