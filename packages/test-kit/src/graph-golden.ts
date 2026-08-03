import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Golden-file serialization for indexed graphs (PRD §42.3, Story 17.3). The representation
// is deliberately lossy: volatile fields (snapshot IDs, timestamps, evidence IDs,
// analysis-run IDs, confidence) are excluded so goldens only change when the *shape* of the
// deterministic graph changes — and every diff line is human-readable.

/** The node fields a graph golden pins. `GraphNode` satisfies this structurally. */
export interface GoldenGraphNode {
  readonly id: string;
  readonly type: string;
  readonly category: string;
  readonly name: string;
  readonly knowledge: { readonly provenance: string };
}

/** The edge fields a graph golden pins. `GraphEdge` satisfies this structurally. */
export interface GoldenGraphEdge {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly knowledge: { readonly provenance: string };
}

export interface GoldenGraphInput {
  readonly nodes: readonly GoldenGraphNode[];
  readonly edges: readonly GoldenGraphEdge[];
}

const nodeLine = (node: GoldenGraphNode): string =>
  `${node.id}|${node.type}|${node.category}|${node.name}|${node.knowledge.provenance}`;

const edgeLine = (edge: GoldenGraphEdge): string =>
  `${edge.type}|${edge.sourceId}->${edge.targetId}|${edge.knowledge.provenance}`;

const lexicographic = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

/**
 * Stable, human-diffable text form of an indexed graph: sorted node lines
 * (`id|type|category|name|provenance`), then sorted edge lines
 * (`type|sourceId->targetId|provenance`). Same graph in, same string out — always.
 */
export const serializeGraphGolden = (graph: GoldenGraphInput): string => {
  const nodes = graph.nodes.map(nodeLine).sort(lexicographic);
  const edges = graph.edges.map(edgeLine).sort(lexicographic);
  return ['nodes:', ...nodes, '', 'edges:', ...edges, ''].join('\n');
};

/** Absolute path to a committed graph golden, e.g. graphGoldenPath('express-app'). */
export const graphGoldenPath = (fixtureName: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'goldens', `${fixtureName}.graph.txt`);
