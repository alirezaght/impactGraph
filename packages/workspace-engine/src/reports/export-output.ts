import { serializeImpactAnalysis, serializeSpecification } from '@impactgraph/domain';

import type {
  ExpectationExport,
  ImpactSummaryExport,
  ImplementationContext,
} from '@impactgraph/application';
import type { CliExportOutput } from '@impactgraph/contracts';

// The §22 export document builder — shared by `impactgraph export` and the MCP
// export_implementation_context tool (identical contract, ADR-0009).

const impactDto = (
  impact: ImpactSummaryExport,
): CliExportOutput['context']['requiredImpacts'][number] => ({
  requirementId: impact.requirementId,
  nodeId: impact.nodeId,
  name: impact.name,
  ...(impact.path === undefined ? {} : { path: impact.path }),
  likelihood: impact.likelihood,
  impactType: impact.impactType,
  directness: impact.directness,
  confidence: impact.confidence,
  explanation: impact.explanation,
  expectedChanges: [...impact.expectedChanges],
  dependencyPath: [...impact.dependencyPath],
  evidenceIds: [...impact.evidenceIds],
});

const expectationDto = (
  item: ExpectationExport,
): CliExportOutput['context']['expectedTests'][number] => ({
  name: item.name,
  reason: item.reason,
  ...(item.nodeId === undefined ? {} : { nodeId: item.nodeId }),
  ...(item.path === undefined ? {} : { path: item.path }),
});

export const buildExportOutput = (context: ImplementationContext): CliExportOutput => ({
  schemaVersion: 1,
  command: 'export',
  context: {
    schemaVersion: 1,
    specification: { ...serializeSpecification(context.specification) },
    approvedAnalysis: { ...serializeImpactAnalysis(context.approvedAnalysis) },
    repositorySnapshot: {
      id: context.repositorySnapshot.id,
      ...(context.repositorySnapshot.branch === undefined
        ? {}
        : { branch: context.repositorySnapshot.branch }),
      commitSha: context.repositorySnapshot.commitSha,
      dirtyWorkingTree: context.repositorySnapshot.dirtyWorkingTree,
      createdAt: context.repositorySnapshot.createdAt,
    },
    requiredImpacts: context.requiredImpacts.map(impactDto),
    likelyImpacts: context.likelyImpacts.map(impactDto),
    rejectedImpacts: context.rejectedImpacts.map(impactDto),
    architectureConstraints: [...context.architectureConstraints],
    expectedTests: context.expectedTests.map(expectationDto),
    expectedMigrations: context.expectedMigrations.map(expectationDto),
    expectedInfrastructureChanges: context.expectedInfrastructureChanges.map(expectationDto),
    openWarnings: context.openWarnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.requirementId === undefined ? {} : { requirementId: warning.requirementId }),
    })),
    reviewCriteria: context.reviewCriteria.map((criterion) => ({
      id: criterion.id,
      kind: criterion.kind,
      description: criterion.description,
      ...(criterion.nodeId === undefined ? {} : { nodeId: criterion.nodeId }),
      ...(criterion.ruleId === undefined ? {} : { ruleId: criterion.ruleId }),
    })),
  },
});
