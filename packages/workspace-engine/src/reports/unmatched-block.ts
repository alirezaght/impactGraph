/**
 * The unmatched-requirement slice of the bounded summary (ADR-0022).
 *
 * Uncapped, with every statement and classification rationale in full, this block alone ran to
 * thousands of tokens on a prose specification — and it is the least actionable part of the
 * document, because a requirement that matched nothing has no surface to look at. The summary
 * carries a bounded, truncated slice; `list_preflight_findings` carries the whole classification
 * list with its rationales.
 */

import { originOf } from '@impactgraph/domain';

import type { CliImpactSummary } from '@impactgraph/contracts';
import type { Requirement, RequirementClassification } from '@impactgraph/domain';

/** Enough to see the shape of the gap; the full list pages from the preflight findings. */
export const UNMATCHED_SUMMARY_LIMIT = 8;

/** Long enough to recognise the requirement, short enough not to reprint the specification. */
const STATEMENT_LIMIT = 160;

const truncate = (statement: string): string =>
  statement.length <= STATEMENT_LIMIT ? statement : `${statement.slice(0, STATEMENT_LIMIT - 1)}…`;

export interface UnmatchedBlock {
  readonly unmatchedRequirements: CliImpactSummary['unmatchedRequirements'];
  readonly omittedUnmatchedRequirementCount?: number;
}

/** One unmatched requirement, carrying WHY nothing matched when the preflight pass classified it. */
const unmatchedLine = (
  requirement: Requirement,
  classifications: readonly RequirementClassification[],
): CliImpactSummary['unmatchedRequirements'][number] => {
  // Classifications are keyed by the label a reader sees (R9), falling back to the internal id.
  const key = requirement.label ?? requirement.id;
  const classified = classifications.find((entry) => entry.requirementId === key);
  return {
    id: requirement.id,
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
    statement: truncate(requirement.statement),
    origin: originOf(requirement),
    ...(classified === undefined
      ? {}
      : {
          classification: classified.classification,
          classificationRationale: classified.rationale,
        }),
  };
};

export const buildUnmatchedBlock = (
  unmatched: readonly Requirement[],
  classifications: readonly RequirementClassification[],
): UnmatchedBlock => ({
  unmatchedRequirements: unmatched
    .slice(0, UNMATCHED_SUMMARY_LIMIT)
    .map((requirement) => unmatchedLine(requirement, classifications)),
  ...(unmatched.length > UNMATCHED_SUMMARY_LIMIT
    ? { omittedUnmatchedRequirementCount: unmatched.length - UNMATCHED_SUMMARY_LIMIT }
    : {}),
});
