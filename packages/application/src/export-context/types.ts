import type { ArchitectureRule } from '../evaluate-rules/types.js';
import type {
  AnalysisWarning,
  ImpactAnalysis,
  ImpactDirectness,
  ImpactLikelihood,
  ImpactType,
  Specification,
} from '@impactgraph/domain';

// PRD §22 — the structured export handed to coding agents. Everything here is derived from
// the approved analysis, the graph it was approved against, and committed config — never
// generated prose as the system of record (§7).

export interface ImpactSummaryExport {
  readonly requirementId: string;
  readonly nodeId: string;
  readonly name: string;
  readonly path?: string | undefined;
  readonly likelihood: ImpactLikelihood;
  readonly impactType: ImpactType;
  readonly directness: ImpactDirectness;
  readonly confidence: number;
  readonly explanation: string;
  readonly expectedChanges: readonly string[];
  readonly dependencyPath: readonly string[];
  readonly evidenceIds: readonly string[];
}

/** An expected test / migration / infrastructure change derived from impact types (§22). */
export interface ExpectationExport {
  readonly name: string;
  readonly reason: string;
  readonly nodeId?: string | undefined;
  readonly path?: string | undefined;
}

/** Machine-checkable criterion for the later review (§22, consumed by Epic 11). */
export interface ReviewCriterionExport {
  readonly id: string;
  readonly kind: 'required-impact' | 'architecture-rule';
  readonly description: string;
  readonly nodeId?: string | undefined;
  readonly ruleId?: string | undefined;
}

export interface RepositorySnapshotSummaryExport {
  readonly id: string;
  readonly branch?: string | undefined;
  readonly commitSha: string;
  readonly dirtyWorkingTree: boolean;
  readonly createdAt: string;
}

export interface ImplementationContext {
  readonly specification: Specification;
  readonly approvedAnalysis: ImpactAnalysis;
  readonly repositorySnapshot: RepositorySnapshotSummaryExport;
  readonly requiredImpacts: readonly ImpactSummaryExport[];
  readonly likelyImpacts: readonly ImpactSummaryExport[];
  readonly rejectedImpacts: readonly ImpactSummaryExport[];
  readonly architectureConstraints: readonly ArchitectureRule[];
  readonly expectedTests: readonly ExpectationExport[];
  readonly expectedMigrations: readonly ExpectationExport[];
  readonly expectedInfrastructureChanges: readonly ExpectationExport[];
  readonly openWarnings: readonly AnalysisWarning[];
  readonly reviewCriteria: readonly ReviewCriterionExport[];
}
