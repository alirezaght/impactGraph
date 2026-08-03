import { err, ok, validationError, validationIssue } from '@impactgraph/domain';

import type {
  ExpectationExport,
  ImpactSummaryExport,
  ImplementationContext,
  RepositorySnapshotSummaryExport,
  ReviewCriterionExport,
} from './types.js';
import type { ArchitectureRule } from '../evaluate-rules/types.js';
import type {
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  RequirementImpact,
  Result,
  Specification,
  ValidationError,
} from '@impactgraph/domain';

// Story 10.1 — §22 builder. Only APPROVED analyses may be exported: an agent implementing
// against a draft would bypass the human-approval gate (§7, §40.3).

export interface BuildImplementationContextRequest {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  /** The graph at the analysis' approved snapshot — names/paths are resolved against it. */
  readonly graph: KnowledgeGraph;
  readonly snapshot: RepositorySnapshotSummaryExport;
  readonly constraints: readonly ArchitectureRule[];
}

const summarize = (impact: RequirementImpact, graph: KnowledgeGraph): ImpactSummaryExport => {
  const node = graph.nodes.get(impact.nodeId as NodeId);
  return {
    requirementId: impact.requirementId,
    nodeId: impact.nodeId,
    name: node?.name ?? impact.nodeId,
    path: node?.path,
    likelihood: impact.likelihood,
    impactType: impact.impactType,
    directness: impact.directness,
    confidence: impact.confidence,
    explanation: impact.explanation,
    expectedChanges: impact.expectedChanges,
    dependencyPath: impact.dependencyPath,
    evidenceIds: impact.evidenceIds,
  };
};

const expectation = (impact: ImpactSummaryExport, reason: string): ExpectationExport => ({
  name: impact.name,
  reason,
  nodeId: impact.nodeId,
  path: impact.path,
});

/** TESTS edges pointing at an impacted node — existing tests the agent must keep green. */
const coveringTests = (
  impacts: readonly ImpactSummaryExport[],
  graph: KnowledgeGraph,
): ExpectationExport[] => {
  const impactedIds = new Set(impacts.map((impact) => impact.nodeId));
  const expectations: ExpectationExport[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.type !== 'TESTS' || !impactedIds.has(edge.targetId)) {
      continue;
    }
    const test = graph.nodes.get(edge.sourceId);
    const target = graph.nodes.get(edge.targetId);
    if (test !== undefined) {
      expectations.push({
        name: test.name,
        reason: `existing test covers '${target?.name ?? edge.targetId}' — expected to change or stay green`,
        nodeId: test.id,
        path: test.path,
      });
    }
  }
  return expectations;
};

const byType = (
  impacts: readonly ImpactSummaryExport[],
  types: readonly string[],
  reason: string,
): ExpectationExport[] =>
  impacts
    .filter((impact) => types.includes(impact.impactType))
    .map((impact) => expectation(impact, reason));

const reviewCriteria = (
  required: readonly ImpactSummaryExport[],
  constraints: readonly ArchitectureRule[],
): ReviewCriterionExport[] => [
  ...required.map((impact, index) => ({
    id: `criterion-impact-${String(index + 1)}`,
    kind: 'required-impact' as const,
    description: `'${impact.name}' must change to satisfy requirement ${impact.requirementId}`,
    nodeId: impact.nodeId,
  })),
  ...constraints.map((rule) => ({
    id: `criterion-rule-${rule.id}`,
    kind: 'architecture-rule' as const,
    description:
      rule.type === 'dependency-direction'
        ? `architecture rule '${rule.id}' must hold after the change`
        : `changes matching '${rule.whenChanged}' must be accompanied by '${rule.requireChanged}' (rule '${rule.id}')`,
    ruleId: rule.id,
  })),
];

export const buildImplementationContext = (
  request: BuildImplementationContextRequest,
): Result<ImplementationContext, ValidationError> => {
  if (request.analysis.status !== 'approved') {
    return err(
      validationError([
        validationIssue(
          'invalid-type',
          'analysis.status',
          `only approved analyses can be exported — '${request.analysis.id}' is '${request.analysis.status}'`,
        ),
      ]),
    );
  }
  const rejectedKeys = new Set(
    request.analysis.userDecisions
      .filter((decision) => decision.decision === 'rejected')
      .map((decision) => `${decision.requirementId}→${decision.nodeId}`),
  );
  const summaries = request.analysis.requirementImpacts.map((impact) => ({
    summary: summarize(impact, request.graph),
    rejected: rejectedKeys.has(`${impact.requirementId}→${impact.nodeId}`),
  }));
  const active = summaries.filter((entry) => !entry.rejected).map((entry) => entry.summary);
  const required = active.filter((impact) => impact.likelihood === 'required');
  const likely = active.filter((impact) => impact.likelihood === 'likely');
  const rejected = summaries.filter((entry) => entry.rejected).map((entry) => entry.summary);

  return ok({
    specification: request.specification,
    approvedAnalysis: request.analysis,
    repositorySnapshot: request.snapshot,
    requiredImpacts: required,
    likelyImpacts: likely,
    rejectedImpacts: rejected,
    architectureConstraints: request.constraints,
    expectedTests: [
      ...byType(active, ['testing'], 'predicted testing impact'),
      ...coveringTests(required, request.graph),
    ],
    expectedMigrations: byType(
      active,
      ['migration', 'data-model'],
      'predicted data/migration impact',
    ),
    expectedInfrastructureChanges: byType(
      active,
      ['infrastructure', 'deployment'],
      'predicted infrastructure impact',
    ),
    openWarnings: request.analysis.warnings,
    reviewCriteria: reviewCriteria(required, request.constraints),
  });
};
