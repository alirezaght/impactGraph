import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import { factsFor, groupLabelFor, planImpactCells } from './graph-impact-cells.js';
import { impactEdges } from './graph-impact-edges.js';
import { PROPOSED_GROUP_LABEL } from './graph-impact-model.js';
import {
  buildImpactRows,
  buildImpactTotals,
  buildRequirementRows,
  buildWarningRows,
  decisionKey,
} from './graph-impact-rows.js';
import { MAX_VISIBLE_EDGES, MAX_VISIBLE_NODES } from './graph-view-model.js';

import type { CellInput, CellPlan, ComponentFacts } from './graph-impact-cells.js';
import type { HopEdgeIndex, ImpactEdgeResult } from './graph-impact-edges.js';
import type {
  ImpactProposedFacts,
  ImpactRequirementRow,
  ImpactViewFacts,
} from './graph-impact-model.js';
import type { RenderCategory } from './graph-render-category.js';
import type { GraphGrouping, GraphView } from './graph-view-model.js';
import type { ImpactAnalysis, Specification } from '@impactgraph/domain';

// Pure builder: a stored impact analysis + the graph it was bound to → the IMPACT read model, in
// the same `GraphView` shape the architecture view produces. No I/O, no clock, no randomness, so
// the same analysis always renders byte-identically (`graph-impact-source.ts` does the loading).

export interface ImpactViewInput {
  readonly grouping: GraphGrouping;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  /** Latest stored version of the specification — the reference point for staleness (§40.2). */
  readonly currentSpecificationVersion: number;
  /** Snapshot whose graph supplied component facts; may differ from the analysis's own. */
  readonly resolvedSnapshotId: string;
  readonly components: ReadonlyMap<string, ComponentFacts>;
  /** nodeId → group label. An absent entry means "unassigned", which is LABELLED, never blank. */
  readonly groupOf: ReadonlyMap<string, string>;
  readonly hopEdges: HopEdgeIndex;
  readonly maxVisibleNodes?: number;
}

const categoryOf = (provenance: string): RenderCategory =>
  knowledgeCategoryForProvenance(provenance) ?? 'unknown';

/**
 * The DIAGRAM draws structural predictions only (item 9: "make its initial view focus on high-value
 * structural results rather than noise").
 *
 * `lexical-only` and `excluded` impacts are not predictions — the first is a text overlap the engine
 * explicitly declined to claim, the second is a component the specification ruled out. Drawing them
 * spends the node budget on the two categories a reader least wants to see first. They are NOT
 * dropped: both keep their rows in the tables below the diagram, where the tier is spelled out.
 */
const drawableAnalysis = (analysis: ImpactAnalysis): ImpactAnalysis => {
  const drawable = analysis.requirementImpacts.filter(
    (impact) => impact.likelihood !== 'lexical-only' && impact.likelihood !== 'excluded',
  );
  return drawable.length === analysis.requirementImpacts.length
    ? analysis
    : { ...analysis, requirementImpacts: drawable };
};

const cellInputOf = (input: ImpactViewInput): CellInput => ({
  grouping: input.grouping,
  analysis: drawableAnalysis(input.analysis),
  components: input.components,
  groupOf: input.groupOf,
  maxVisibleNodes: input.maxVisibleNodes ?? MAX_VISIBLE_NODES,
});

const proposedFacts = (analysis: ImpactAnalysis): ImpactProposedFacts | undefined => {
  const structure = analysis.proposedStructure;
  if (structure === undefined) {
    return undefined;
  }
  return {
    nodes: structure.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      category: node.category,
      originOptionId: node.originOptionId,
      rationale: node.rationale,
      provenance: node.provenance,
      knowledgeCategory: categoryOf(node.provenance),
      confidence: node.confidence,
    })),
    relationships: structure.relationships.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceKind: edge.sourceKind,
      targetKind: edge.targetKind,
      type: edge.type,
      originOptionId: edge.originOptionId,
      rationale: edge.rationale,
      provenance: edge.provenance,
      knowledgeCategory: categoryOf(edge.provenance),
      confidence: edge.confidence,
    })),
  };
};

const impactFactsOf = (
  input: ImpactViewInput,
  plan: CellPlan,
  edges: ImpactEdgeResult,
  requirements: readonly ImpactRequirementRow[],
): ImpactViewFacts => {
  const cellInput = cellInputOf(input);
  const impacts = input.analysis.requirementImpacts;
  const proposed = proposedFacts(input.analysis);
  const spec = input.specification;
  return {
    analysisId: input.analysis.id,
    analysisStatus: input.analysis.status,
    createdAt: input.analysis.createdAt,
    specificationId: spec.id,
    specificationVersion: input.analysis.specificationVersion,
    specificationTitle: spec.title,
    ...(spec.sourceReference === undefined ? {} : { specificationSource: spec.sourceReference }),
    boundSnapshotId: input.analysis.repositorySnapshotId,
    resolvedSnapshotId: input.resolvedSnapshotId,
    snapshotMatches: input.resolvedSnapshotId === input.analysis.repositorySnapshotId,
    specificationStale: input.currentSpecificationVersion > input.analysis.specificationVersion,
    currentSpecificationVersion: input.currentSpecificationVersion,
    totals: buildImpactTotals({
      impacts,
      requirements,
      componentCount: plan.impactedComponentCount,
      componentsShown: plan.impactedComponentsShown,
      crossGroupHops: edges.interGroup,
      crossGroupHopsDrawn: edges.drawnHops,
    }),
    requirements,
    impacts: buildImpactRows(impacts, {
      nameOf: (nodeId) => factsFor(nodeId, input.components).name,
      groupOf: (nodeId) => groupLabelFor(cellInput, nodeId),
      drawn: new Set(plan.nodes.map((node) => node.id)),
      decisions: new Map(
        input.analysis.userDecisions.map((decision) => [
          decisionKey(decision.requirementId, decision.nodeId),
          decision,
        ]),
      ),
    }),
    warnings: buildWarningRows(input.analysis.warnings),
    ...(proposed === undefined ? {} : { proposed }),
  };
};

export const buildImpactView = (input: ImpactViewInput): GraphView => {
  const cellInput = cellInputOf(input);
  const plan = planImpactCells(cellInput);
  const edges = impactEdges({
    impacts: drawableAnalysis(input.analysis).requirementImpacts,
    proposed: input.analysis.proposedStructure,
    hopEdges: input.hopEdges,
    drawnGroups: plan.drawnGroupIds,
    groupFor: (nodeId) => groupLabelFor(cellInput, nodeId),
    proposedGroupLabel: PROPOSED_GROUP_LABEL,
  });
  const requirements = buildRequirementRows(
    input.specification.requirements,
    input.analysis.requirementImpacts,
    input.analysis.warnings,
  );
  return {
    kind: 'impact',
    snapshotId: input.analysis.repositorySnapshotId,
    grouping: input.grouping,
    groups: plan.groups,
    nodes: plan.nodes,
    edges: edges.aggregated.slice(0, MAX_VISIBLE_EDGES),
    budget: plan.budget,
    edgeTotals: {
      graphEdges: edges.hopPairs,
      // The impact view draws dependency paths, not containment; there is no CONTAINS scaffolding.
      containment: 0,
      intraGroup: edges.intraGroup,
      interGroup: edges.interGroup,
      aggregated: edges.aggregated.length,
      aggregatedShown: Math.min(edges.aggregated.length, MAX_VISIBLE_EDGES),
      truncated: edges.aggregated.length > MAX_VISIBLE_EDGES,
    },
    impact: impactFactsOf(input, plan, edges, requirements),
  };
};
