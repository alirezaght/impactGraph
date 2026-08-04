import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';
import { isProvenance, knowledgeCategoryOf } from '../provenance/provenance.js';

import { capLikelihood, isImpactEvidenceType, primaryEvidenceType } from './evidence-basis.js';
import { collectProposedStructureIssues } from './proposed-structure.js';

import type { ImpactEvidenceType } from './evidence-basis.js';
import type { ProposedStructure } from './proposed-structure.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ConfidenceSignal } from '../provenance/confidence.js';
import type { Provenance } from '../provenance/provenance.js';

// PRD §13 — implemented as written, plus stored confidence signals (§14: every score must be
// explainable from its contributing signals; a bare number is never enough).

/**
 * PRD §13 tiers plus the two the trials showed were missing.
 *
 * `lexical-only` — surfaced because text overlapped and nothing else. It is a real result (an
 * agent asking "anything else that mentions this?" wants it) but it is not a prediction, so it
 * needs its own tier rather than being smuggled in at `possible`, where structural findings live.
 *
 * `excluded` — actively ruled out, e.g. by a specification non-goal. Distinct from `unlikely`,
 * which is a weak positive: `excluded` says the specification told us not to go there. It stays in
 * the analysis (append-only) so a reviewer can see what was ruled out and why.
 */
export const IMPACT_LIKELIHOODS = [
  'required',
  'likely',
  'possible',
  'lexical-only',
  'unlikely',
  'excluded',
] as const;
export type ImpactLikelihood = (typeof IMPACT_LIKELIHOODS)[number];

/** Tiers a default view shows — `lexical-only`, `unlikely` and `excluded` are opt-in. */
export const PREDICTIVE_LIKELIHOODS: readonly ImpactLikelihood[] = [
  'required',
  'likely',
  'possible',
];

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
  /**
   * Additive field: why this impact was selected, from the closed §evidence-basis vocabulary,
   * strongest basis first. Absent on analyses stored before the taxonomy existed — read through
   * `evidenceTypesOf`, which maps absence to `lexical-only`, the weakest reading.
   */
  readonly evidenceTypes?: readonly ImpactEvidenceType[];
  /**
   * Additive field: set when the tier was reduced, and by what. Makes the cap auditable — a reader
   * can see that a candidate scored well but was held at `possible` because its only basis was a
   * name resemblance.
   */
  readonly tierCappedBy?: ImpactEvidenceType;
}

/** Absence is read as the weakest basis, never as "unclassified but fine". */
export const evidenceTypesOf = (impact: RequirementImpact): readonly ImpactEvidenceType[] =>
  impact.evidenceTypes === undefined || impact.evidenceTypes.length === 0
    ? ['lexical-only']
    : impact.evidenceTypes;

export const ANALYSIS_WARNING_CODES = [
  'unknown-concept',
  'ambiguous-concept',
  'uncertain-eligibility',
  'unmatched-requirement',
  'traversal-cutoff',
  'traversal-exhausted',
  'unsupported-claim',
  'invalid-reference',
  'configured-exclusion',
  'non-goal-exclusion',
  'non-goal-contradiction',
  'unresolved-concept',
  'provisional-extraction',
  'stale-index',
  'coverage-gap',
] as const;

export interface AnalysisWarning {
  readonly code:
    | 'unknown-concept'
    /** A concept spread over too many unrelated components to anchor an impact (§C2). */
    | 'ambiguous-concept'
    /** A dependency's ecosystem could not be established, so it was not suppressed. */
    | 'uncertain-eligibility'
    /** A requirement produced no impacts at all — the analysis says nothing about it. */
    | 'unmatched-requirement'
    | 'traversal-cutoff'
    /** The traversal safety budget stopped the walk — distinct from the output-size cap. */
    | 'traversal-exhausted'
    | 'unsupported-claim'
    | 'invalid-reference'
    /** An impact was suppressed by a §Z9 learned exclusion in committed configuration. */
    | 'configured-exclusion'
    /** A specification non-goal names this component, so its impact was downgraded. */
    | 'non-goal-exclusion'
    /** A non-goal excludes a component the graph says must change — a real contradiction. */
    | 'non-goal-contradiction'
    /**
     * The specification names something that resolves to no indexed artifact. Reported as an
     * unresolved concept instead of being invented as a node (item 2).
     */
    | 'unresolved-concept'
    /** The requirement list was extractor prose, so the whole analysis is provisional (item 1). */
    | 'provisional-extraction'
    /** The index no longer matches the working tree or HEAD (item 10). */
    | 'stale-index'
    /** Indexing gaps overlap the predicted area, so absence of impact proves little (item 10). */
    | 'coverage-gap';
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
  issues.push(...evidenceBasisIssues(impact, path));
  return issues;
};

/**
 * The enforcement point for "a lexical match must never be labeled required" (item 3).
 *
 * A record claiming a strong tier on a weak basis is REJECTED, not quietly downgraded. A quiet
 * downgrade hides the producer bug that created it, and this invariant is the whole promise the tier
 * labels make to a reader.
 */
const evidenceBasisIssues = (impact: RequirementImpact, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const types = impact.evidenceTypes ?? [];
  for (const type of types) {
    if (!isImpactEvidenceType(type)) {
      issues.push(
        validationIssue(
          'invalid-type',
          `${path}.evidenceTypes`,
          `unknown evidence type '${String(type)}'`,
        ),
      );
    }
  }
  if (impact.tierCappedBy !== undefined && !isImpactEvidenceType(impact.tierCappedBy)) {
    issues.push(validationIssue('invalid-type', `${path}.tierCappedBy`, 'unknown evidence type'));
  }
  if (types.length === 0) {
    return issues;
  }
  const capped = capLikelihood(impact.likelihood, types);
  if (capped !== impact.likelihood) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.likelihood`,
        `'${impact.likelihood}' is not available on '${primaryEvidenceType(types)}' evidence (max '${capped}')`,
      ),
    );
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
