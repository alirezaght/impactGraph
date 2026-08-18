import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Directory-segment resolution: the fallback tier that lets a specification name a service that
// exists only as a directory. Extracted from `concept-matching.ts` so name resolution and
// directory resolution are two responsibilities in two files (effective-LOC policy).

/** Shared by every matcher: comparison ignores case, separators, and punctuation. */
export const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Below this many normalized characters, a segment match is a coincidence ("api", "app"). */
const MIN_SEGMENT_CONCEPT_LENGTH = 6;

/** Node types that stand for a whole directory: the manifest-bearing container. */
const CONTAINER_TYPES = new Set(['package', 'workspace']);

const inDirectory = (path: string, asPrefix: string | undefined, target: string): number => {
  const segments = path.split('/');
  if (asPrefix !== undefined) {
    return path.startsWith(asPrefix) ? asPrefix.split('/').length - 2 : -1;
  }
  return segments
    .slice(0, -1)
    .findIndex((segment) => normalize(segment) === target && normalize(segment).length > 0);
};

interface SegmentHits {
  readonly containers: GraphNode[];
  readonly files: { node: GraphNode; depth: number }[];
}

const collectSegmentHits = (
  graph: KnowledgeGraph,
  asPrefix: string | undefined,
  target: string,
): SegmentHits => {
  const hits: SegmentHits = { containers: [], files: [] };
  for (const node of graph.nodes.values()) {
    if (node.path === undefined) {
      continue;
    }
    const index = inDirectory(node.path, asPrefix, target);
    if (index < 0) {
      continue;
    }
    // The manifest-bearing container IS the directory: "apps/mcp-server" names one package, not
    // its five shallowest files. Only a directory with no container falls back to files.
    if (CONTAINER_TYPES.has(node.type) && node.path.split('/').length - index === 2) {
      hits.containers.push(node);
    } else if (node.type === 'file') {
      hits.files.push({ node, depth: node.path.split('/').length - index });
    }
  }
  return hits;
};

/**
 * A service that exists only as a directory — no manifest, no Terraform resource, no node NAMED
 * after it — is still a component a specification can name. A concept equal to a directory
 * segment resolves to the files under that directory, shallowest first, so plans that name such
 * a service can be checked against the constraints that govern its path. Bounded and marked
 * ambiguous: the concept names the container, and which file inside changes stays a guess.
 */
export const findByPathSegment = (graph: KnowledgeGraph, concept: string): GraphNode[] => {
  const target = normalize(concept);
  const asPrefix = concept.includes('/') ? `${concept.replace(/\/+$/, '')}/` : undefined;
  if (asPrefix === undefined && target.length < MIN_SEGMENT_CONCEPT_LENGTH) {
    return [];
  }
  const { containers, files } = collectSegmentHits(graph, asPrefix, target);
  if (containers.length > 0) {
    return containers.sort((a, b) => a.id.localeCompare(b.id));
  }
  return files
    .sort((a, b) => a.depth - b.depth || a.node.id.localeCompare(b.node.id))
    .map((hit) => hit.node);
};
