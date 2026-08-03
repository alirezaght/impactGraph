import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';

// PRD §24.1 review result categories and §25 coverage — implemented with the exact meanings.
// A discrepancy is never automatically a defect: findings are inputs to human judgment (§43.6).

export const REVIEW_CATEGORIES = [
  'matched',
  'missing',
  'unexpected',
  'divergent',
  'unverifiable',
  'accepted-deviation',
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export interface ReviewFinding {
  readonly category: ReviewCategory;
  /** The graph node the finding is about (approved-impact node or newly changed node). */
  readonly nodeId: string;
  readonly nodeName: string;
  readonly requirementId?: string;
  readonly explanation: string;
  readonly filePaths: readonly string[];
}

export const COVERAGE_STATUSES = [
  'implemented',
  'partially-implemented',
  'not-found',
  'unclear',
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** One §25 evidence line: ✓ confirmed, ✕ missing, ? unclear. */
export interface CoverageEvidence {
  readonly marker: 'confirmed' | 'missing' | 'unclear';
  readonly note: string;
}

export interface RequirementCoverage {
  readonly requirementId: string;
  readonly statement: string;
  readonly status: CoverageStatus;
  readonly evidence: readonly CoverageEvidence[];
}

export const REVIEW_TARGETS = ['working-tree', 'commit'] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

export interface EdgeChangeSummary {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface ImplementationReview {
  readonly id: string;
  readonly analysisId: string;
  /** The snapshot the current state was indexed under for this review. */
  readonly reviewSnapshotId: string;
  readonly target: ReviewTarget;
  readonly createdAt: string;
  readonly changedFiles: readonly string[];
  readonly findings: readonly ReviewFinding[];
  readonly coverage: readonly RequirementCoverage[];
  readonly edgeChanges: EdgeChangeSummary;
}

const findingIssues = (finding: ReviewFinding, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [...blankIdIssue(finding.nodeId, `${path}.nodeId`)];
  if (!(REVIEW_CATEGORIES as readonly string[]).includes(finding.category)) {
    issues.push(validationIssue('invalid-type', `${path}.category`, 'unknown review category'));
  }
  if (finding.explanation.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.explanation`, 'explanation required'));
  }
  return issues;
};

export const createImplementationReview = (
  input: ImplementationReview,
): Result<ImplementationReview, ValidationError> => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.analysisId, 'analysisId'),
    ...blankIdIssue(input.reviewSnapshotId, 'reviewSnapshotId'),
  ];
  if (!(REVIEW_TARGETS as readonly string[]).includes(input.target)) {
    issues.push(validationIssue('invalid-type', 'target', 'unknown review target'));
  }
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(validationIssue('invalid-timestamp', 'createdAt', 'must be ISO-8601'));
  }
  input.findings.forEach((finding, index) => {
    issues.push(...findingIssues(finding, `findings[${index}]`));
  });
  input.coverage.forEach((coverage, index) => {
    if (!(COVERAGE_STATUSES as readonly string[]).includes(coverage.status)) {
      issues.push(
        validationIssue('invalid-type', `coverage[${index}].status`, 'unknown coverage status'),
      );
    }
  });
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(deepFreeze({ ...input }));
};

/** True when the review contains discrepancies (CLI exit-code semantics, PRD §20). */
export const hasDiscrepancies = (review: ImplementationReview): boolean =>
  review.findings.some(
    (finding) =>
      finding.category === 'missing' ||
      finding.category === 'unexpected' ||
      finding.category === 'divergent',
  );
