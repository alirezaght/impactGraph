/**
 * The answer, first (ADR-0022).
 *
 * A review report is read to settle one question — did the implementation satisfy the plan? — and
 * that answer was previously reachable only by counting findings in a large document. The verdict
 * is a deterministic function of the findings already classified by §24.1: it invents nothing and
 * ranks nothing by model judgment.
 *
 * `reuse-confirmed` deliberately reads as success: a planned surface that stayed unchanged BY
 * DESIGN is the plan working, not a gap. Accepted deviations are answered questions, so they no
 * longer count toward the failure signal.
 */

import type { ReviewCategory, ReviewFinding } from './implementation-review.js';

export const REVIEW_VERDICT_STATUSES = ['PASS', 'NEEDS_ATTENTION'] as const;
export type ReviewVerdictStatus = (typeof REVIEW_VERDICT_STATUSES)[number];

export interface ReviewVerdictCounts {
  readonly matched: number;
  readonly missing: number;
  readonly unexpected: number;
  readonly divergent: number;
  /** Surfaces a preservation requirement protected that the diff modified anyway. */
  readonly guardViolated: number;
  readonly reuseConfirmed: number;
  readonly unverifiable: number;
  readonly acceptedDeviations: number;
  readonly ruleViolations: number;
}

export interface DecidingFinding {
  readonly category: ReviewCategory;
  readonly nodeId: string;
  readonly explanation: string;
}

export interface ReviewVerdict {
  readonly status: ReviewVerdictStatus;
  readonly headline: string;
  readonly counts: ReviewVerdictCounts;
  readonly decidingFindings: readonly DecidingFinding[];
}

export interface ReviewVerdictInput {
  readonly findings: readonly ReviewFinding[];
  readonly ruleViolationCount: number;
  /** Node ids whose discrepancy a human already accepted as a deviation (§24.1). */
  readonly acceptedNodeIds: readonly string[];
}

/** Enough to see WHY without reproducing the finding list in the headline block. */
const DECIDING_LIMIT = 5;

/**
 * Ordered by how much a reader must act on them. A diff that touches fifty generated files must
 * not push the one missing requirement out of the deciding slice — array order is the order
 * findings happened to be produced in, which carries no meaning for the reader.
 *
 * A guard violation ranks second only to missing work: the author named that surface precisely to
 * say "do not change this", so crossing the boundary outranks changing something differently than
 * planned.
 */
const DISCREPANCY_CATEGORIES: readonly ReviewCategory[] = [
  'missing',
  'guard-violated',
  'divergent',
  'unexpected',
];

const countOf = (findings: readonly ReviewFinding[], category: ReviewCategory): number =>
  findings.filter((finding) => finding.category === category).length;

const phrase = (count: number, singular: string, plural: string): string =>
  `${String(count)} ${count === 1 ? singular : plural}`;

const headlineFor = (status: ReviewVerdictStatus, counts: ReviewVerdictCounts): string => {
  const parts =
    status === 'PASS'
      ? [
          phrase(counts.ruleViolations, 'violation', 'violations'),
          phrase(counts.missing, 'missing requirement', 'missing requirements'),
          `${phrase(counts.guardViolated, 'regression boundary', 'regression boundaries')} crossed`,
          `${phrase(counts.reuseConfirmed, 'planned surface', 'planned surfaces')} reused unchanged by design`,
          `${phrase(counts.matched, 'predicted change', 'predicted changes')} occurred`,
          `${phrase(counts.unexpected, 'additional surface', 'additional surfaces')} changed`,
        ]
      : [
          phrase(counts.missing, 'missing requirement', 'missing requirements'),
          `${phrase(counts.guardViolated, 'regression boundary', 'regression boundaries')} crossed`,
          phrase(counts.unexpected, 'unexpected change', 'unexpected changes'),
          phrase(counts.divergent, 'divergent surface', 'divergent surfaces'),
          phrase(counts.ruleViolations, 'constraint violation', 'constraint violations'),
        ];
  const label = status === 'PASS' ? 'PASS' : 'NEEDS ATTENTION';
  return `Implementation review: ${label} — ${parts.join(', ')}.`;
};

export const reviewVerdict = (input: ReviewVerdictInput): ReviewVerdict => {
  const accepted = new Set(input.acceptedNodeIds);
  const counts: ReviewVerdictCounts = {
    matched: countOf(input.findings, 'matched'),
    missing: countOf(input.findings, 'missing'),
    unexpected: countOf(input.findings, 'unexpected'),
    divergent: countOf(input.findings, 'divergent'),
    guardViolated: countOf(input.findings, 'guard-violated'),
    reuseConfirmed: countOf(input.findings, 'reuse-confirmed'),
    unverifiable: countOf(input.findings, 'unverifiable'),
    acceptedDeviations: input.findings.filter((finding) => accepted.has(finding.nodeId)).length,
    ruleViolations: input.ruleViolationCount,
  };
  const unanswered = input.findings
    .filter(
      (finding) =>
        DISCREPANCY_CATEGORIES.includes(finding.category) && !accepted.has(finding.nodeId),
    )
    .sort(
      (left, right) =>
        DISCREPANCY_CATEGORIES.indexOf(left.category) -
        DISCREPANCY_CATEGORIES.indexOf(right.category),
    );
  const status: ReviewVerdictStatus =
    unanswered.length > 0 || input.ruleViolationCount > 0 ? 'NEEDS_ATTENTION' : 'PASS';
  return {
    status,
    headline: headlineFor(status, counts),
    counts,
    decidingFindings: unanswered.slice(0, DECIDING_LIMIT).map((finding) => ({
      category: finding.category,
      nodeId: finding.nodeId,
      explanation: finding.explanation,
    })),
  };
};
