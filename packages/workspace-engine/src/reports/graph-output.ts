import type { GraphView } from './graph-view-model.js';
import type { CliGraphOutput, GraphViewDto } from '@impactgraph/contracts';

// The `--format json` / MCP projection of the same read model the HTML renderer draws. One
// builder, so the picture and the data can never disagree about what was shown.

export interface GraphOutputExtras {
  readonly writtenPath?: string | undefined;
  readonly byteSize?: number | undefined;
}

const viewDto = (view: GraphView): GraphViewDto => ({
  snapshotId: view.snapshotId,
  grouping: view.grouping,
  groups: view.groups.map((group) => ({
    id: group.id,
    label: group.label,
    totalNodes: group.totalNodes,
    shownNodes: group.shownNodes,
    hiddenNodes: group.hiddenNodes,
    countsByKnowledgeCategory: { ...group.countsByKnowledgeCategory },
  })),
  nodes: view.nodes.map((node) => ({
    id: node.id,
    groupId: node.groupId,
    name: node.name,
    type: node.type,
    category: node.category,
    ...(node.path === undefined ? {} : { path: node.path }),
    provenance: node.provenance,
    knowledgeCategory: node.knowledgeCategory,
  })),
  edges: view.edges.map((edge) => ({
    sourceGroupId: edge.sourceGroupId,
    targetGroupId: edge.targetGroupId,
    knowledgeCategory: edge.knowledgeCategory,
    kinds: edge.kinds.map((kind) => ({ type: kind.type, count: kind.count })),
    count: edge.count,
  })),
  budget: { ...view.budget },
  edgeTotals: { ...view.edgeTotals },
});

export const buildGraphOutput = (
  view: GraphView,
  extras: GraphOutputExtras = {},
): CliGraphOutput => ({
  schemaVersion: 1,
  command: 'graph',
  ...(extras.writtenPath === undefined ? {} : { writtenPath: extras.writtenPath }),
  ...(extras.byteSize === undefined ? {} : { byteSize: extras.byteSize }),
  view: viewDto(view),
});
