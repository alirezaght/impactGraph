import type { ImpactViewFacts } from './graph-impact-model.js';
import type { GraphView } from './graph-view-model.js';
import type { CliGraphOutput, GraphViewDto, ImpactViewFactsDto } from '@impactgraph/contracts';

// The `--format json` / MCP projection of the same read model the HTML renderer draws. One
// builder, so the picture and the data can never disagree about what was shown.

/**
 * The §18.5 payload as data. Mapped field by field rather than spread, so a new engine-side field
 * cannot leak into a validated boundary document without someone deciding it should.
 */
const impactDto = (facts: ImpactViewFacts): ImpactViewFactsDto => ({
  analysisId: facts.analysisId,
  analysisStatus: facts.analysisStatus,
  createdAt: facts.createdAt,
  specificationId: facts.specificationId,
  specificationVersion: facts.specificationVersion,
  specificationTitle: facts.specificationTitle,
  ...(facts.specificationSource === undefined
    ? {}
    : { specificationSource: facts.specificationSource }),
  boundSnapshotId: facts.boundSnapshotId,
  resolvedSnapshotId: facts.resolvedSnapshotId,
  snapshotMatches: facts.snapshotMatches,
  specificationStale: facts.specificationStale,
  currentSpecificationVersion: facts.currentSpecificationVersion,
  totals: {
    ...facts.totals,
    byLikelihood: { ...facts.totals.byLikelihood },
    byImpactType: facts.totals.byImpactType.map((entry) => ({ ...entry })),
    byKnowledgeCategory: { ...facts.totals.byKnowledgeCategory },
    hopBuckets: facts.totals.hopBuckets.map((entry) => ({ ...entry })),
  },
  requirements: facts.requirements.map((entry) => ({
    ...entry,
    warningCodes: [...entry.warningCodes],
  })),
  impacts: facts.impacts.map((entry) => ({
    ...entry,
    dependencyPath: [...entry.dependencyPath],
    expectedChanges: [...entry.expectedChanges],
    signals: entry.signals.map((signal) => ({ ...signal })),
  })),
  warnings: facts.warnings.map((entry) => ({ ...entry })),
  ...(facts.proposed === undefined
    ? {}
    : {
        proposed: {
          nodes: facts.proposed.nodes.map((node) => ({ ...node })),
          relationships: facts.proposed.relationships.map((edge) => ({ ...edge })),
        },
      }),
});

export interface GraphOutputExtras {
  readonly writtenPath?: string | undefined;
  readonly byteSize?: number | undefined;
}

const viewDto = (view: GraphView): GraphViewDto => ({
  kind: view.kind,
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
    ...(node.impact === undefined
      ? {}
      : {
          impact: {
            ...node.impact,
            impactTypes: [...node.impact.impactTypes],
            requirementIds: [...node.impact.requirementIds],
          },
        }),
    ...(node.proposed === true ? { proposed: true as const } : {}),
  })),
  edges: view.edges.map((edge) => ({
    sourceGroupId: edge.sourceGroupId,
    targetGroupId: edge.targetGroupId,
    knowledgeCategory: edge.knowledgeCategory,
    // Emitted only when proposed: a document with no `status` anywhere is entirely current
    // structure, which keeps the architecture projection byte-for-byte what it always was.
    ...(edge.status === 'proposed' ? { status: 'proposed' as const } : {}),
    kinds: edge.kinds.map((kind) => ({ type: kind.type, count: kind.count })),
    count: edge.count,
  })),
  budget: { ...view.budget },
  edgeTotals: { ...view.edgeTotals },
  ...(view.impact === undefined ? {} : { impact: impactDto(view.impact) }),
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
