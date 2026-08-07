import {
  contextsBlock,
  contractsBlock,
  integrationPointsBlock,
  repositoryBlocks,
} from './architecture-boundaries.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { withConfiguredContexts } from './overlay-context-graph.js';
import { readOverlayConfig, resolveOverlay } from './overlay.js';
import { readRepositoryRoster } from './registered-repositories.js';
import { memberPrefix } from './repository-coverage.js';

import type { ContextSummaryEntry, ContractDocumentEntry } from './architecture-boundaries.js';
import type { Failable } from './failure.js';
import type { CorrectionSummary, EffectiveView } from './overlay.js';
import type {
  CrossRepositoryEdgeReport,
  RepositoryBreakdownEntry,
} from './repository-attribution.js';
import type { ConfigPrecedenceLevelDto } from '@impactgraph/contracts';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// `query_architecture` / `impactgraph architecture` — composition of the current graph, plus the
// §16 corrections overlaid on it. `totalEdges` keeps meaning "edges in the deterministic graph":
// rejected relationships are listed explicitly with their reason and counted separately, so an
// exclusion is always visible rather than silently subtracted (§16, §3). Declared bounded
// contexts ARE part of the deterministic read-time graph (provenance `configuration`), so their
// nodes and membership edges appear in the census like any other configuration-derived fact.

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
  /** Declared bounded contexts with structural membership (item 6). Absent when none declared. */
  readonly contexts?: readonly ContextSummaryEntry[];
  /** Per-repository breakdown; absent unless related repositories are registered (item 6). */
  readonly repositories?: readonly RepositoryBreakdownEntry[];
  /** Edges spanning registered repositories; absent unless related repositories are registered. */
  readonly crossRepositoryEdges?: CrossRepositoryEdgeReport;
  /** Integration-point counts by node type (topics, webhooks, external APIs, …). */
  readonly integrationPoints?: Record<string, number>;
  /** Declared contract documents (OpenAPI + generated contracts), bounded. */
  readonly contracts?: readonly ContractDocumentEntry[];
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

/** Repository breakdown + cross-repository edges; an unreadable roster omits the blocks. */
const repositoryBlocksFor = (
  rootDir: string,
  graph: KnowledgeGraph,
): ReturnType<typeof repositoryBlocks> => {
  const roster = readRepositoryRoster(rootDir);
  if (!roster.ok) {
    return {};
  }
  return repositoryBlocks(graph, roster.value, (member) => memberPrefix(rootDir, member));
};

export const summarizeArchitecture = async (
  rootDir: string,
): Promise<Failable<ArchitectureSummary>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const architecture = readOverlayConfig(rootDir);
    // The read-time graph: declared bounded contexts emitted as nodes and membership edges.
    const graph = withConfiguredContexts(current.value.graph, architecture, {
      snapshotId: current.value.snapshotId,
      createdAt: new Date().toISOString(),
    });
    const nodes = [...graph.nodes.values()];
    const edges = [...graph.edges.values()];
    const overlay = resolveOverlay(graph, architecture);
    const rejectedEdges = rejectedOf(overlay);
    const contexts = contextsBlock(graph, architecture);
    const integrationPoints = integrationPointsBlock(graph);
    const contracts = contractsBlock(graph);
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
        ...(contexts === undefined ? {} : { contexts }),
        ...repositoryBlocksFor(rootDir, graph),
        ...(integrationPoints === undefined ? {} : { integrationPoints }),
        ...(contracts === undefined ? {} : { contracts }),
      },
    };
  });
