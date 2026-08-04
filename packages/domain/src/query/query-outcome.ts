import { validationIssue } from '../errors/validation.js';

import type { ValidationIssue } from '../errors/validation.js';

/**
 * Explicit query provenance (item 11: "ImpactGraph allowed agents to infer facts such as 'no
 * callers' without actually running a caller query").
 *
 * "No callers" and "I did not look" are the same output shape and opposite claims. An agent reading
 * an empty array cannot tell them apart, so it picks the more useful reading and deletes the
 * function. This type makes the difference unrepresentable-as-identical: an empty result must state
 * WHICH status it has and over WHAT scope, and there is no way to serialize an empty list without
 * one.
 */
export const QUERY_STATUSES = [
  /** The query was never executed. An empty result here means NOTHING. */
  'not-run',
  /** Executed to completion, results found. */
  'completed',
  /** Executed to completion over a stated scope, and genuinely found nothing IN THAT SCOPE. */
  'completed-empty',
  /** Executed, but truncated, cancelled, or blocked on part of the scope. */
  'partial',
  'failed',
  /** A human confirmed the answer. Supersedes an inferred one; never rewrites it (§3). */
  'human-confirmed',
] as const;

export type QueryStatus = (typeof QUERY_STATUSES)[number];

export interface QueryOutcome {
  readonly status: QueryStatus;
  /**
   * What was actually searched, in words a reader can check: "the indexed graph of this repository
   * at snapshot snap-abc123 (1 repository, 412 files)". Required — a status without a scope is
   * still unfalsifiable.
   */
  readonly scope: string;
  /** What was NOT searched. The half that stops an empty result being over-read. */
  readonly limitations: readonly string[];
  readonly resultCount: number;
  /** Set when `status` is `partial` or `failed`. */
  readonly reason?: string;
}

export const isQueryStatus = (value: unknown): value is QueryStatus =>
  typeof value === 'string' && (QUERY_STATUSES as readonly string[]).includes(value);

export const queryOutcomeIssues = (outcome: QueryOutcome, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isQueryStatus(outcome.status)) {
    issues.push(validationIssue('invalid-type', `${path}.status`, 'unknown query status'));
  }
  if (outcome.scope.trim().length === 0) {
    issues.push(
      validationIssue(
        'blank-field',
        `${path}.scope`,
        'a query outcome must state the scope it covered — an unscoped negative result is unfalsifiable',
      ),
    );
  }
  if (!Number.isInteger(outcome.resultCount) || outcome.resultCount < 0) {
    issues.push(validationIssue('out-of-range', `${path}.resultCount`, 'must be an integer >= 0'));
  }
  if (outcome.status === 'completed' && outcome.resultCount === 0) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.status`,
        "an empty result is 'completed-empty', never 'completed'",
      ),
    );
  }
  if (
    (outcome.status === 'partial' || outcome.status === 'failed') &&
    outcome.reason === undefined
  ) {
    issues.push(
      validationIssue('blank-field', `${path}.reason`, `'${outcome.status}' requires a reason`),
    );
  }
  return issues;
};

/**
 * The one constructor. Deriving the status from the count is deliberate: a producer cannot
 * accidentally report `completed` with nothing in hand, and cannot report emptiness without also
 * having supplied a scope.
 */
export const queryOutcome = (input: {
  readonly scope: string;
  readonly resultCount: number;
  readonly limitations?: readonly string[];
  readonly partialReason?: string;
}): QueryOutcome => ({
  status:
    input.partialReason !== undefined
      ? 'partial'
      : input.resultCount === 0
        ? 'completed-empty'
        : 'completed',
  scope: input.scope,
  limitations: input.limitations ?? [],
  resultCount: input.resultCount,
  ...(input.partialReason === undefined ? {} : { reason: input.partialReason }),
});

export const notRunOutcome = (scope: string, reason: string): QueryOutcome => ({
  status: 'not-run',
  scope,
  limitations: [reason],
  resultCount: 0,
});

export const failedOutcome = (scope: string, reason: string): QueryOutcome => ({
  status: 'failed',
  scope,
  limitations: [],
  resultCount: 0,
  reason,
});

/**
 * The sentence a consumer should print for an empty result. Phrased as the trial asked: "No inbound
 * callers were found in the indexed repository. External repositories were not analyzed." — never
 * "this symbol has no callers".
 */
export const describeOutcome = (outcome: QueryOutcome, subject: string): string => {
  const limits = outcome.limitations.length === 0 ? '' : ` ${outcome.limitations.join(' ')}`;
  switch (outcome.status) {
    case 'not-run':
      return `No ${subject} query was run, so nothing is known about it.${limits}`;
    case 'failed':
      return `The ${subject} query failed (${outcome.reason ?? 'unknown reason'}), so nothing is known about it.${limits}`;
    case 'partial':
      return `The ${subject} query completed only partially (${outcome.reason ?? 'truncated'}) over ${outcome.scope}; ${String(outcome.resultCount)} result(s) so far.${limits}`;
    case 'completed-empty':
      return `No ${subject} were found in ${outcome.scope}.${limits}`;
    case 'human-confirmed':
      return `A human confirmed the ${subject} result over ${outcome.scope}: ${String(outcome.resultCount)} result(s).${limits}`;
    case 'completed':
      return `${String(outcome.resultCount)} ${subject} found in ${outcome.scope}.${limits}`;
  }
};
