import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ImpactEvidenceType } from '../impact/evidence-basis.js';
import type { ImpactLikelihood } from '../impact/impact-analysis.js';

/**
 * What an implementation ACTUALLY touched (item 12: "There was no way to record the actual changed
 * files and findings after implementation, so precision and recall could not be measured or
 * improved").
 *
 * This is the missing half of the loop. Without it, every accuracy claim about ImpactGraph rests on
 * hand-written fixture ground truth, which measures the fixtures and not the tool in use. With it,
 * each real change leaves a measurable outcome behind.
 *
 * The record is EVIDENCE, never training data. It is append-only, it never mutates the analysis it
 * measures, and it never rewrites confirmed repository knowledge — one result is a data point, and
 * promoting a data point to a rule is how a tool learns the wrong lesson confidently. Ranking
 * changes are a human decision informed by these records, not an effect of them.
 */
export interface ActualChangedSymbol {
  readonly filePath: string;
  readonly symbolName: string;
  readonly kind: 'added' | 'removed' | 'changed';
}

/** A relationship the implementation added or removed, in the §12.2 vocabulary. */
export interface ActualRelationshipChange {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: 'added' | 'removed';
}

/** A trap the implementer or reviewer hit that the analysis did not predict. */
export interface ManualFinding {
  readonly note: string;
  readonly filePath?: string | undefined;
  /** `risk` — a hazard met while implementing. `correction` — the reviewer disputing a prediction. */
  readonly kind: 'risk' | 'correction';
}

export interface ActualImpact {
  readonly id: string;
  /** The analysis this outcome measures. Never modified by recording. */
  readonly analysisId: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly recordedAt: string;
  /** Existing files the implementation modified. */
  readonly changedFiles: readonly string[];
  readonly addedFiles: readonly string[];
  readonly removedFiles: readonly string[];
  readonly changedSymbols: readonly ActualChangedSymbol[];
  readonly relationshipChanges: readonly ActualRelationshipChange[];
  /** Contract documents, schemas and migrations the implementation touched. */
  readonly contractsChanged: readonly string[];
  readonly migrationsChanged: readonly string[];
  readonly manualFindings: readonly ManualFinding[];
  /** Free-text note from whoever recorded it. Human-authored, and labeled as such. */
  readonly note?: string | undefined;
}

const stringArrayIssues = (values: readonly string[], path: string): ValidationIssue[] =>
  values.some((value) => value.trim().length === 0)
    ? [validationIssue('blank-field', path, 'entries must not be blank')]
    : [];

const actualImpactIssues = (input: ActualImpact): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.analysisId, 'analysisId'),
    ...blankIdIssue(input.specificationId, 'specificationId'),
    ...stringArrayIssues(input.changedFiles, 'changedFiles'),
    ...stringArrayIssues(input.addedFiles, 'addedFiles'),
    ...stringArrayIssues(input.removedFiles, 'removedFiles'),
  ];
  if (!isValidTimestamp(input.recordedAt)) {
    issues.push(validationIssue('invalid-timestamp', 'recordedAt', 'must be ISO-8601'));
  }
  if (!Number.isInteger(input.specificationVersion) || input.specificationVersion < 1) {
    issues.push(validationIssue('out-of-range', 'specificationVersion', 'must be >= 1'));
  }
  // An outcome that names no change measures nothing, and would drag every aggregate toward zero.
  if (
    input.changedFiles.length + input.addedFiles.length + input.removedFiles.length === 0 &&
    input.manualFindings.length === 0
  ) {
    issues.push(
      validationIssue(
        'blank-field',
        'changedFiles',
        'an actual-impact record must name at least one changed/added/removed file, or a manual finding',
      ),
    );
  }
  return issues;
};

export const createActualImpact = (input: ActualImpact): Result<ActualImpact, ValidationError> => {
  const issues = actualImpactIssues(input);
  return issues.length > 0 ? err(validationError(issues)) : ok(deepFreeze({ ...input }));
};

/** Artifact categories the analysis can predict — mirrors the summary's prediction vocabulary. */
export const ARTIFACT_CATEGORIES = [
  'new-locale-entry',
  'new-test',
  'new-event-handler',
  'new-migration',
  'new-contract-definition',
  'new-configuration-entry',
] as const;

export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number];

/**
 * Measured accuracy of one prediction against one outcome.
 *
 * Every figure is computed from the two records and nothing else, so it is reproducible and
 * auditable. Where a figure cannot be computed honestly it is `undefined` rather than zero — a
 * precision of 0 and "no predictions to judge" are different facts.
 */
export interface EvaluationMetrics {
  readonly analysisId: string;
  readonly actualImpactId: string;
  /** Predicted-and-changed ÷ predicted, over the tiers being judged. undefined when none. */
  readonly precision?: number;
  /** Predicted-and-changed ÷ changed. undefined when the outcome names no changed file. */
  readonly recall?: number;
  readonly truePositives: readonly string[];
  readonly falsePositives: readonly string[];
  readonly falseNegatives: readonly string[];
  /**
   * Mean reciprocal rank of the changed files within the ranked prediction, 0..1. Answers "were the
   * files that mattered near the top?", which precision alone cannot: a result can be 100% precise
   * and still bury the one file the implementer needed at position 40.
   */
  readonly rankingQuality?: number;
  /** Artifact categories the outcome shows were needed and the analysis did not predict. */
  readonly missedArtifactCategories: readonly ArtifactCategory[];
  /** Relationship types the implementation added that no predicted impact route contained. */
  readonly missedRelationshipTypes: readonly string[];
  /** Which tiers were counted as predictions. Precision is meaningless without it. */
  readonly judgedTiers: readonly ImpactLikelihood[];
  /** Evidence bases of the false positives — the actionable half of a precision number. */
  readonly falsePositiveBases: readonly ImpactEvidenceType[];
}
