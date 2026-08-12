import { checkPlanContract } from '@impactgraph/application';
import { stableContentId } from '@impactgraph/domain';

import { loadConstraints } from './preflight-guards.js';

import type { PlanContractResult } from '@impactgraph/application';
import type {
  EdgeId,
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  NodeId,
} from '@impactgraph/domain';

/**
 * Assemble the plan contract from the approved analysis and check it against the diff.
 *
 * The approved analysis is already the contract — it states which components must change and, since
 * ADR-0017, which rules governed that decision. Nothing new is asked of the user; what changes is
 * that the claims are now checked instead of archived.
 */

export interface PlanContractInput {
  readonly rootDir: string;
  readonly analysis: ImpactAnalysis;
  readonly review: ImplementationReview;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
}

const pathsOf = (graph: KnowledgeGraph, nodeIds: Iterable<string>): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const nodeId of nodeIds) {
    const path = graph.nodes.get(nodeId as NodeId)?.path;
    if (path !== undefined) {
      paths.add(path);
    }
  }
  return paths;
};

/** Node ids the changed files resolve to in the post-implementation graph. */
const changedNodeIds = (
  graph: KnowledgeGraph,
  changedFiles: readonly string[],
): ReadonlySet<string> => {
  const changed = new Set(changedFiles);
  const ids = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.path !== undefined && changed.has(node.path)) {
      ids.add(String(node.id));
    }
  }
  return ids;
};

const addedEdges = (
  review: ImplementationReview,
  currentGraph: KnowledgeGraph,
): {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly evidenceIds: readonly string[];
}[] =>
  review.edgeChanges.added
    .map((edgeId) => currentGraph.edges.get(edgeId as EdgeId))
    .filter((edge) => edge !== undefined)
    .map((edge) => ({
      type: edge.type,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      evidenceIds: [...edge.knowledge.evidenceIds],
    }));

/** Runtime processes the approved impacts touched — what the plan said would be on the path. */
const runtimeProcesses = (analysis: ImpactAnalysis, graph: KnowledgeGraph): ReadonlySet<string> => {
  const processes = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    const type = graph.nodes.get(impact.nodeId as NodeId)?.type;
    if (type === 'container' || type === 'runtime-process' || type === 'cloud-run-service') {
      processes.add(impact.nodeId);
    }
  }
  return processes;
};

/** Configuration the approved impacts named — what the plan said had to propagate. */
const requiredConfigNames = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): readonly string[] => {
  const names = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    const node = graph.nodes.get(impact.nodeId as NodeId);
    if (node?.type === 'environment-variable' || node?.type === 'config-key') {
      names.add(node.name);
    }
  }
  return [...names].sort();
};

export const reviewAgainstPlan = (input: PlanContractInput): PlanContractResult => {
  const expectedNodeIds = new Set(input.analysis.requirementImpacts.map((impact) => impact.nodeId));
  const constraints = loadConstraints(
    input.rootDir,
    input.currentGraph,
    input.review.reviewSnapshotId,
    input.review.createdAt,
  ).constraints;
  return checkPlanContract({
    plan: {
      expectedNodeIds,
      expectedPaths: pathsOf(input.approvedGraph, expectedNodeIds),
      constraints,
      runtimeProcessNodeIds: runtimeProcesses(input.analysis, input.approvedGraph),
      requiredConfigNames: requiredConfigNames(input.analysis, input.approvedGraph),
    },
    actual: {
      changedPaths: [...input.review.changedFiles],
      changedNodeIds: changedNodeIds(input.currentGraph, input.review.changedFiles),
      addedEdges: addedEdges(input.review, input.currentGraph),
      graph: input.currentGraph,
    },
    nextId: (seed) => stableContentId('review-finding', seed),
  });
};
