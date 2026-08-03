import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { overlayFor } from './overlay.js';

import type { Failable } from './failure.js';
import type { CorrectionSummary, EffectiveView } from './overlay.js';
import type { ConfigPrecedenceLevelDto } from '@impactgraph/contracts';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';

// `query_architecture` / `impactgraph architecture` — composition of the current graph, plus the
// §16 corrections overlaid on it. `totalEdges` keeps meaning "edges in the deterministic graph":
// rejected relationships are listed explicitly with their reason and counted separately, so an
// exclusion is always visible rather than silently subtracted (§16, §3).

export interface RejectedEdgeSummary {
  readonly edgeId: string;
  readonly reason?: string | undefined;
  readonly level: ConfigPrecedenceLevelDto;
}

export interface ArchitectureSummary {
  readonly snapshotId: string;
  readonly workspaces: readonly string[];
  readonly packages: readonly { name: string; fileCount: number }[];
  readonly nodeCountsByType: Record<string, number>;
  readonly edgeCountsByType: Record<string, number>;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly corrections: CorrectionSummary;
  /** Edges remaining after rejected relationships are excluded (§16). */
  readonly effectiveTotalEdges: number;
  readonly rejectedEdges: readonly RejectedEdgeSummary[];
}

const countBy = <T>(records: readonly T[], key: (record: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[key(record)] = (counts[key(record)] ?? 0) + 1;
  }
  return counts;
};

const packagesOf = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { name: string; fileCount: number }[] =>
  nodes
    .filter((node) => node.type === 'package')
    .map((node) => ({
      name: node.name,
      fileCount: edges.filter(
        (edge) =>
          edge.type === 'CONTAINS' &&
          edge.sourceId === node.id &&
          edge.targetId.startsWith('file:'),
      ).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const rejectedOf = (overlay: EffectiveView): RejectedEdgeSummary[] =>
  [...overlay.relationships.values()]
    .filter((entry) => entry.excluded)
    .map((entry) => ({ edgeId: entry.edgeId, reason: entry.reason, level: entry.level }))
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));

export const summarizeArchitecture = async (
  rootDir: string,
): Promise<Failable<ArchitectureSummary>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const nodes = [...current.value.graph.nodes.values()];
    const edges = [...current.value.graph.edges.values()];
    const overlay = overlayFor(rootDir, current.value.graph);
    const rejectedEdges = rejectedOf(overlay);
    return {
      ok: true,
      value: {
        snapshotId: current.value.snapshotId,
        workspaces: nodes
          .filter((node) => node.type === 'workspace')
          .map((node) => node.name)
          .sort(),
        packages: packagesOf(nodes, edges),
        nodeCountsByType: countBy(nodes, (node) => node.type),
        edgeCountsByType: countBy(edges, (edge) => edge.type),
        totalNodes: nodes.length,
        totalEdges: edges.length,
        corrections: overlay.summary,
        effectiveTotalEdges: edges.length - rejectedEdges.length,
        rejectedEdges,
      },
    };
  });
