import { reviewVerdict } from '@impactgraph/domain';

import { buildReviewBreakdown } from './review-breakdown.js';
import { driftOmittedTotal } from './review-drift.js';

import type { ReviewRepositoryScope } from './review-scope.js';
import type { RuleViolation } from '@impactgraph/application';
import type { AcceptedDeviationDto, CliReviewDrift, CliReviewOutput } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  Specification,
} from '@impactgraph/domain';

// The §38.2 review document builder — shared by `impactgraph review` and the MCP
// review_implementation / get_review_report tools (identical contract, ADR-0009).

/**
 * The item-13 breakdown rides alongside the concise summary rather than replacing it: the trials
 * called that summary useful, so it keeps its exact shape and the breakdown is additive.
 */
export interface ReviewBreakdownContext {
  readonly specification: Specification;
  readonly currentGraph: KnowledgeGraph;
  readonly addedPaths?: readonly string[];
  /** Measured roster state for scope limitations and confidence (item 7). */
  readonly repositoryScope?: ReviewRepositoryScope;
  /** Classified drift block (item 7) — computed by the pipeline, absent when it could not be. */
  readonly drift?: CliReviewDrift;
}

const edgeChangesDto = (review: ImplementationReview): CliReviewOutput['edgeChanges'] => ({
  added: [...review.edgeChanges.added],
  removed: [...review.edgeChanges.removed],
  ...(review.edgeChanges.omittedAdded === undefined
    ? {}
    : { omittedAdded: review.edgeChanges.omittedAdded }),
  ...(review.edgeChanges.omittedRemoved === undefined
    ? {}
    : { omittedRemoved: review.edgeChanges.omittedRemoved }),
});

const breakdownDto = (
  review: ImplementationReview,
  analysis: ImpactAnalysis,
  context: ReviewBreakdownContext,
): NonNullable<CliReviewOutput['breakdown']> =>
  buildReviewBreakdown({
    review,
    analysis,
    specification: context.specification,
    currentGraph: context.currentGraph,
    ...(context.addedPaths === undefined ? {} : { addedPaths: context.addedPaths }),
    ...(context.repositoryScope === undefined ? {} : { repositoryScope: context.repositoryScope }),
    ...(context.drift === undefined ? {} : { driftOmitted: driftOmittedTotal(context.drift) }),
  });

/**
 * The additive baseline-provenance block: which analysis the review compared against and with
 * what authority. A superseded analysis never reaches a review (`loadReviewBaseline` rejects it),
 * so the impossible case emits no block rather than a false claim.
 */
const baselineDto = (analysis: ImpactAnalysis): Pick<CliReviewOutput, 'baseline'> =>
  analysis.status === 'superseded'
    ? {}
    : {
        baseline: {
          analysisId: analysis.id,
          status: analysis.status,
          authority:
            analysis.status === 'approved' ? 'approved-contract' : 'unapproved-prediction',
          snapshotId: analysis.repositorySnapshotId,
        },
      };

/**
 * ADR-0022 wire cap per category. The persisted artifact keeps every finding; a 137-file diff
 * previously put 137 findings on the wire and buried the answer. Mirrors SUMMARY_FINDING_LIMIT.
 */
const WIRE_FINDING_LIMIT = 12;

type WireFinding = CliReviewOutput['findings'][number];

interface BoundedFindings {
  readonly findings: WireFinding[];
  readonly truncated: Record<string, number>;
}

/**
 * Keep the first `WIRE_FINDING_LIMIT` of each category and COUNT the rest. Bounding per category
 * rather than overall keeps one noisy category from evicting the single missing requirement that
 * decides the verdict.
 */
const boundFindings = (findings: readonly WireFinding[]): BoundedFindings => {
  const kept: WireFinding[] = [];
  const seen = new Map<string, number>();
  const truncated: Record<string, number> = {};
  for (const finding of findings) {
    const count = (seen.get(finding.category) ?? 0) + 1;
    seen.set(finding.category, count);
    if (count <= WIRE_FINDING_LIMIT) {
      kept.push(finding);
    } else {
      truncated[finding.category] = (truncated[finding.category] ?? 0) + 1;
    }
  }
  return { findings: kept, truncated };
};

export interface ReviewOutputExtras {
  readonly breakdownContext?: ReviewBreakdownContext | undefined;
  /**
   * ADR-0017/0021 — the plan-as-contract block the pipeline computed. Absent means the caller had
   * no pipeline run to draw on, never "the plan was honoured".
   */
  readonly planContract?: CliReviewOutput['planContract'];
  /**
   * Deviations a human already accepted for this review. They answer a discrepancy, so the verdict
   * stops counting them as failures — the finding itself is never rewritten (§24.1).
   */
  readonly acceptedDeviations?: readonly AcceptedDeviationDto[];
  /** Set when the caller keeps the full finding list reachable elsewhere (the stored artifact). */
  readonly boundFindings?: boolean;
}

export const buildReviewOutput = (
  review: ImplementationReview,
  analysis: ImpactAnalysis,
  violations: readonly RuleViolation[],
  extras: ReviewOutputExtras = {},
): CliReviewOutput => {
  const allFindings: WireFinding[] = review.findings.map((finding) => ({
    category: finding.category,
    nodeId: finding.nodeId,
    nodeName: finding.nodeName,
    ...(finding.requirementId === undefined ? {} : { requirementId: finding.requirementId }),
    explanation: finding.explanation,
    filePaths: [...finding.filePaths],
  }));
  const bounded =
    extras.boundFindings === false
      ? { findings: allFindings, truncated: {} }
      : boundFindings(allFindings);
  const verdict = reviewVerdict({
    findings: review.findings,
    ruleViolationCount: violations.length,
    acceptedNodeIds: (extras.acceptedDeviations ?? []).map((deviation) => deviation.nodeId),
  });
  return {
  verdict: {
    status: verdict.status,
    headline: verdict.headline,
    counts: verdict.counts,
    decidingFindings: verdict.decidingFindings.map((finding) => ({
      category: finding.category,
      nodeId: finding.nodeId,
      explanation: finding.explanation,
    })),
    ...(Object.keys(bounded.truncated).length === 0
      ? {}
      : { truncatedFindingCounts: bounded.truncated }),
  },
  ...(extras.planContract === undefined ? {} : { planContract: extras.planContract }),
  schemaVersion: 1,
  command: 'review',
  reviewId: review.id,
  analysis: {
    id: analysis.id,
    specificationId: analysis.specificationId,
    specificationVersion: analysis.specificationVersion,
    approvedSnapshotId: analysis.repositorySnapshotId,
  },
  ...baselineDto(analysis),
  target: review.target,
  reviewSnapshotId: review.reviewSnapshotId,
  changedFiles: [...review.changedFiles],
  findings: bounded.findings,
  coverage: review.coverage.map((entry) => ({
    requirementId: entry.requirementId,
    statement: entry.statement,
    status: entry.status,
    evidence: entry.evidence.map((line) => ({ marker: line.marker, note: line.note })),
  })),
  edgeChanges: edgeChangesDto(review),
  ruleViolations: violations.map((violation) => ({
    ruleId: violation.ruleId,
    message: violation.message,
    filePaths: [...violation.evidence.filePaths],
    ...(violation.evidence.edgeId === undefined ? {} : { edgeId: violation.evidence.edgeId }),
  })),
  discrepanciesFound: verdict.status === 'NEEDS_ATTENTION',
  ...(extras.breakdownContext === undefined
    ? {}
    : { breakdown: breakdownDto(review, analysis, extras.breakdownContext) }),
  ...(extras.breakdownContext?.drift === undefined
    ? {}
    : { drift: extras.breakdownContext.drift }),
  };
};

/**
 * §24.1: mark findings that carry an accepted-deviation decision with the recorded reason.
 * Findings are never rewritten or recategorized — the mark rides alongside; the report
 * renders marked findings in the Accepted Deviations section (§38.2).
 */
export const applyAcceptedDeviations = (
  document: CliReviewOutput,
  deviations: readonly AcceptedDeviationDto[],
): CliReviewOutput => {
  const findings = document.findings.map((finding) => {
    const decision = deviations.find(
      (candidate) => candidate.nodeId === finding.nodeId && candidate.category === finding.category,
    );
    return decision === undefined
      ? finding
      : { ...finding, acceptedDeviation: { reason: decision.reason } };
  });
  // An accepted deviation is an answered question, so the verdict is recomputed rather than left
  // saying NEEDS_ATTENTION about a discrepancy a human already settled (ADR-0022).
  const verdict = reviewVerdict({
    findings: findings.map((finding) => ({
      category: finding.category,
      nodeId: finding.nodeId,
      nodeName: finding.nodeName,
      explanation: finding.explanation,
      filePaths: finding.filePaths,
    })),
    ruleViolationCount: document.ruleViolations.length,
    acceptedNodeIds: deviations.map((deviation) => deviation.nodeId),
  });
  return {
    ...document,
    verdict: {
      status: verdict.status,
      headline: verdict.headline,
      counts: verdict.counts,
      decidingFindings: [...verdict.decidingFindings],
      ...(document.verdict?.truncatedFindingCounts === undefined
        ? {}
        : { truncatedFindingCounts: document.verdict.truncatedFindingCounts }),
    },
    findings,
    discrepanciesFound: verdict.status === 'NEEDS_ATTENTION',
  };
};

export interface ReviewFindingPage {
  readonly category?: string | undefined;
  readonly topN?: number | undefined;
  readonly offset?: number | undefined;
}

/**
 * Page the findings of a stored review. The artifact keeps every finding; this is how a caller
 * reaches the ones the bounded default omitted, without the default having to carry them all.
 */
export const pageReviewFindings = (
  document: CliReviewOutput,
  page: ReviewFindingPage,
): CliReviewOutput => {
  const matching =
    page.category === undefined
      ? document.findings
      : document.findings.filter((finding) => finding.category === page.category);
  const offset = Math.max(0, page.offset ?? 0);
  const limit = page.topN ?? matching.length;
  const slice = matching.slice(offset, offset + limit);
  const omitted = matching.length - offset - slice.length;
  const truncated: Record<string, number> = {};
  if (omitted > 0) {
    truncated[page.category ?? 'all'] = omitted;
  }
  return {
    ...document,
    ...(document.verdict === undefined
      ? {}
      : {
          verdict: {
            ...document.verdict,
            ...(omitted > 0 ? { truncatedFindingCounts: truncated } : {}),
          },
        }),
    findings: slice,
  };
};
