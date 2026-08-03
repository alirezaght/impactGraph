import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Golden-file serialization for indexed graphs (PRD §42.3, Story 17.3). The representation
// is deliberately lossy: volatile fields (snapshot IDs, timestamps, evidence IDs,
// analysis-run IDs, confidence) are excluded so goldens only change when the *shape* of the
// deterministic graph changes — and every diff line is human-readable.

/** The node fields a graph golden pins. `GraphNode` satisfies this structurally. */
export interface GoldenRouteParameter {
  readonly name: string;
  readonly required: boolean;
}

export interface GoldenGraphNode {
  readonly id: string;
  readonly type: string;
  readonly category: string;
  readonly name: string;
  /**
   * §12.1.1 route contract. Pinned because it is first-class persisted state now: a golden that
   * showed only the display name could not detect a contract regression, and parameter extraction
   * would land invisibly.
   */
  readonly route?: {
    readonly path: string;
    readonly method?: string;
    readonly pathParameters: readonly GoldenRouteParameter[];
    readonly queryParameters: readonly GoldenRouteParameter[];
  };
  readonly knowledge: { readonly provenance: string };
}

/** The edge fields a graph golden pins. `GraphEdge` satisfies this structurally. */
export interface GoldenGraphEdge {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  /**
   * Evidence IDs stay excluded as volatile, but their COUNT does not vary between runs, and without
   * it a movement report cannot tell an edge whose evidence changed from one that did not. Pinning
   * the count is the smallest thing that makes `evidence-changed` a real category rather than a
   * label the report can never apply.
   */
  readonly knowledge: { readonly provenance: string; readonly evidenceIds: readonly string[] };
}

export interface GoldenGraphInput {
  readonly nodes: readonly GoldenGraphNode[];
  readonly edges: readonly GoldenGraphEdge[];
}

/** `GET /api/deals p:id!,slug? q:limit?` — compact, pipe-free, and `-` when a node states no route. */
const routeCell = (node: GoldenGraphNode): string => {
  const route = node.route;
  if (route === undefined) {
    return '-';
  }
  const parameters = (entries: readonly GoldenRouteParameter[], label: string): string =>
    entries.length === 0
      ? ''
      : ` ${label}:${entries.map((entry) => `${entry.name}${entry.required ? '!' : '?'}`).join(',')}`;
  return (
    `${route.method ?? 'ANY'} ${route.path}` +
    parameters(route.pathParameters, 'p') +
    parameters(route.queryParameters, 'q')
  );
};

const nodeLine = (node: GoldenGraphNode): string =>
  [node.id, node.type, node.category, node.name, node.knowledge.provenance, routeCell(node)].join(
    '|',
  );

const edgeLine = (edge: GoldenGraphEdge): string =>
  [
    edge.type,
    `${edge.sourceId}->${edge.targetId}`,
    edge.knowledge.provenance,
    `ev${String(edge.knowledge.evidenceIds.length)}`,
  ].join('|');

const lexicographic = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

/**
 * Stable, human-diffable text form of an indexed graph: sorted node lines
 * (`id|type|category|name|provenance|route`), then sorted edge lines
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
