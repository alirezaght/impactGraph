import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';
import { isProvenance, knowledgeCategoryOf } from '../provenance/provenance.js';

import { collectProposedStructureIssues } from './proposed-structure.js';

import type { ProposedStructure } from './proposed-structure.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ConfidenceSignal } from '../provenance/confidence.js';
import type { Provenance } from '../provenance/provenance.js';

// PRD §13 — implemented as written, plus stored confidence signals (§14: every score must be
// explainable from its contributing signals; a bare number is never enough).

export const IMPACT_LIKELIHOODS = ['required', 'likely', 'possible', 'unlikely'] as const;
export type ImpactLikelihood = (typeof IMPACT_LIKELIHOODS)[number];

export const IMPACT_TYPES = [
  'domain-model',
  'business-rule',
  'api-contract',
  'data-model',
  'migration',
  'event-contract',
  'read-model',
  'background-processing',
  'integration',
  'security',
  'observability',
  'performance',
  'infrastructure',
  'deployment',
  'testing',
  'documentation',
] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];

export const IMPACT_DIRECTNESS = ['direct', 'indirect'] as const;
export type ImpactDirectness = (typeof IMPACT_DIRECTNESS)[number];

export interface RequirementImpact {
  readonly requirementId: string;
  readonly nodeId: string;
  readonly likelihood: ImpactLikelihood;
  readonly impactType: ImpactType;
  readonly directness: ImpactDirectness;
  readonly confidence: number;
  readonly confidenceSignals: readonly ConfidenceSignal[];
  readonly explanation: string;
  readonly expectedChanges: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly dependencyPath: readonly string[];
  readonly provenance: Provenance;
}

export interface AnalysisWarning {
  readonly code:
    | 'unknown-concept'
    /** A concept spread over too many unrelated components to anchor an impact (§C2). */
    | 'ambiguous-concept'
    /** A requirement produced no impacts at all — the analysis says nothing about it. */
    | 'unmatched-requirement'
    | 'traversal-cutoff'
    | 'unsupported-claim'
    | 'invalid-reference'
    /** An impact was suppressed by a §Z9 learned exclusion in committed configuration. */
    | 'configured-exclusion';
  readonly message: string;
  readonly requirementId?: string;
}

export const USER_DECISION_KINDS = ['accepted', 'rejected', 'manually-added'] as const;
export type UserDecisionKind = (typeof USER_DECISION_KINDS)[number];

/** Append-only (PRD §40.3): a rejected impact stays in the analysis with its decision. */
export interface UserImpactDecision {
  readonly id: string;
  readonly requirementId: string;
  readonly nodeId: string;
  readonly decision: UserDecisionKind;
  readonly reason?: string;
  readonly decidedAt: string;
}

/**
 * §26 implications of choosing an option. Every field is DERIVED from the option's graph
 * footprint (categories and types of the affected nodes), never model prose — so "requires a
 * migration" is a claim the evidence supports, not something a model asserted.
 */
export interface OptionImplications {
  readonly affectedComponentCount: number;
  /** Data-model / migration work implied by data-category nodes in the footprint. */
  readonly dataChanges: readonly string[];
  /** Contract changes implied by API and event nodes in the footprint. */
  readonly contractChanges: readonly string[];
  readonly infrastructureChanges: readonly string[];
  readonly testingImpact: readonly string[];
  readonly complexity: 'low' | 'medium' | 'high';
  /** Deterministic risk statements, each traceable to a footprint fact. */
  readonly risks: readonly string[];
}

/** AI-assisted alternative approach (PRD §26); grows with Story 6.6. */
export interface ArchitecturalOption {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly affectedNodeIds: readonly string[];
  /**
   * §C8: the open question this option answers. Selecting the option resolves that question —
   * without this link, selection could only record a decision and leave the question open.
   */
  readonly linkedQuestionId?: string | undefined;
  /** §26: what choosing this option implies, derived from the footprint. */
  readonly implications?: OptionImplications | undefined;
}

export const ANALYSIS_STATUSES = ['draft', 'reviewed', 'approved', 'superseded'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export interface ImpactAnalysis {
  readonly id: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly repositorySnapshotId: string;
  readonly createdAt: string;
  readonly status: AnalysisStatus;
  readonly requirementImpacts: readonly RequirementImpact[];
  readonly architecturalOptions: readonly ArchitecturalOption[];
  readonly warnings: readonly AnalysisWarning[];
  readonly userDecisions: readonly UserImpactDecision[];
  /**
   * §18.4/§26: relationships (and components) the architectural options WOULD create. A separate
   * field on purpose — proposed structure is never merged into `requirementImpacts` or into the
   * deterministic graph, so current and proposed can be diffed rather than confused (§3).
   * Absent means the engine asserted no proposed structure, never "unknown".
   */
  readonly proposedStructure?: ProposedStructure | undefined;
}

/** Extra facts the caller can supply so proposals are validated against the bound snapshot. */
export interface ImpactAnalysisContext {
  readonly existingNodeIds?: ReadonlySet<string> | undefined;
}

const impactTaxonomyIssues = (impact: RequirementImpact, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!(IMPACT_LIKELIHOODS as readonly string[]).includes(impact.likelihood)) {
    issues.push(validationIssue('invalid-type', `${path}.likelihood`, 'unknown likelihood'));
  }
  if (!(IMPACT_TYPES as readonly string[]).includes(impact.impactType)) {
    issues.push(validationIssue('invalid-type', `${path}.impactType`, 'unknown impactType'));
  }
  if (!(IMPACT_DIRECTNESS as readonly string[]).includes(impact.directness)) {
    issues.push(validationIssue('invalid-type', `${path}.directness`, 'unknown directness'));
  }
  if (!isProvenance(impact.provenance) || knowledgeCategoryOf(impact.provenance) === 'reserved') {
    issues.push(validationIssue('unknown-provenance', `${path}.provenance`, 'invalid provenance'));
  }
  return issues;
};

const impactIssues = (impact: RequirementImpact, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(impact.requirementId, `${path}.requirementId`),
    ...blankIdIssue(impact.nodeId, `${path}.nodeId`),
    ...impactTaxonomyIssues(impact, path),
  ];
  if (!Number.isFinite(impact.confidence) || impact.confidence < 0 || impact.confidence > 1) {
    issues.push(validationIssue('out-of-range', `${path}.confidence`, 'confidence must be 0..1'));
  }
  if (impact.confidenceSignals.length === 0) {
    issues.push(
      validationIssue(
        'missing-signals',
        `${path}.confidenceSignals`,
        'impact confidence must carry contributing signals (PRD §14)',
      ),
    );
  }
  if (impact.evidenceIds.length === 0 && impact.provenance !== 'human-confirmed') {
    issues.push(
      validationIssue('missing-evidence', `${path}.evidenceIds`, 'impacts require evidence'),
    );
  }
  if (impact.explanation.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.explanation`, 'explanation required'));
  }
  return issues;
};

const proposedIssues = (
  input: ImpactAnalysis,
  context: ImpactAnalysisContext,
): ValidationIssue[] =>
  input.proposedStructure === undefined
    ? []
    : collectProposedStructureIssues(
        input.proposedStructure,
        {
          existingNodeIds: context.existingNodeIds,
          optionIds: new Set(input.architecturalOptions.map((option) => option.id)),
        },
        'proposedStructure',
      );

const analysisIssues = (
  input: ImpactAnalysis,
  context: ImpactAnalysisContext,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.specificationId, 'specificationId'),
    ...blankIdIssue(input.repositorySnapshotId, 'repositorySnapshotId'),
  ];
  if (!Number.isInteger(input.specificationVersion) || input.specificationVersion < 1) {
    issues.push(validationIssue('out-of-range', 'specificationVersion', 'must be >= 1'));
  }
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(validationIssue('invalid-timestamp', 'createdAt', 'must be ISO-8601'));
  }
  if (!(ANALYSIS_STATUSES as readonly string[]).includes(input.status)) {
    issues.push(validationIssue('invalid-type', 'status', 'unknown status'));
  }
  input.requirementImpacts.forEach((impact, index) => {
    issues.push(...impactIssues(impact, `requirementImpacts[${index}]`));
  });
  issues.push(...proposedIssues(input, context));
  return issues;
};

export const createImpactAnalysis = (
  input: ImpactAnalysis,
  context: ImpactAnalysisContext = {},
): Result<ImpactAnalysis, ValidationError> => {
  const issues = analysisIssues(input, context);
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(deepFreeze({ ...input }));
};

const transition = (
  analysis: ImpactAnalysis,
  from: readonly AnalysisStatus[],
  to: AnalysisStatus,
): Result<ImpactAnalysis, ValidationError> => {
  if (!from.includes(analysis.status)) {
    return err(
      validationError([
        validationIssue(
          'invalid-type',
          'status',
          `cannot move '${analysis.status}' analysis to '${to}'`,
        ),
      ]),
    );
  }
  return createImpactAnalysis({ ...analysis, status: to });
};

/** Approval freezes the analysis (PRD §40.3); only draft/reviewed analyses can be approved. */
export const approveImpactAnalysis = (
  analysis: ImpactAnalysis,
): Result<ImpactAnalysis, ValidationError> =>
  transition(analysis, ['draft', 'reviewed'], 'approved');

export const markImpactAnalysisReviewed = (
  analysis: ImpactAnalysis,
): Result<ImpactAnalysis, ValidationError> => transition(analysis, ['draft'], 'reviewed');

/** Supersession is a status change on the old record — content is never rewritten. */
export const supersedeImpactAnalysis = (
  analysis: ImpactAnalysis,
): Result<ImpactAnalysis, ValidationError> =>
  transition(analysis, ['draft', 'reviewed', 'approved'], 'superseded');

/** Decisions append; nothing is removed. Approved analyses reject new decisions. */
export const addUserDecision = (
  analysis: ImpactAnalysis,
  decision: UserImpactDecision,
): Result<ImpactAnalysis, ValidationError> => {
  if (analysis.status === 'approved' || analysis.status === 'superseded') {
    return err(
      validationError([
        validationIssue('invalid-type', 'status', 'decisions cannot be added after approval'),
      ]),
    );
  }
  if (!(USER_DECISION_KINDS as readonly string[]).includes(decision.decision)) {
    return err(validationError([validationIssue('invalid-type', 'decision', 'unknown decision')]));
  }
  return createImpactAnalysis({
    ...analysis,
    userDecisions: [...analysis.userDecisions, decision],
  });
};
