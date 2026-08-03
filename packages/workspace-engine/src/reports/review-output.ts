import { hasDiscrepancies } from '@impactgraph/domain';

import type { RuleViolation } from '@impactgraph/application';
import type { AcceptedDeviationDto, CliReviewOutput } from '@impactgraph/contracts';
import type { ImpactAnalysis, ImplementationReview } from '@impactgraph/domain';

// The §38.2 review document builder — shared by `impactgraph review` and the MCP
// review_implementation / get_review_report tools (identical contract, ADR-0009).

export const buildReviewOutput = (
  review: ImplementationReview,
  analysis: ImpactAnalysis,
  violations: readonly RuleViolation[],
): CliReviewOutput => ({
  schemaVersion: 1,
  command: 'review',
  reviewId: review.id,
  analysis: {
    id: analysis.id,
    specificationId: analysis.specificationId,
    specificationVersion: analysis.specificationVersion,
    approvedSnapshotId: analysis.repositorySnapshotId,
  },
  target: review.target,
  reviewSnapshotId: review.reviewSnapshotId,
  changedFiles: [...review.changedFiles],
  findings: review.findings.map((finding) => ({
    category: finding.category,
    nodeId: finding.nodeId,
    nodeName: finding.nodeName,
    ...(finding.requirementId === undefined ? {} : { requirementId: finding.requirementId }),
    explanation: finding.explanation,
    filePaths: [...finding.filePaths],
  })),
  coverage: review.coverage.map((entry) => ({
    requirementId: entry.requirementId,
    statement: entry.statement,
    status: entry.status,
    evidence: entry.evidence.map((line) => ({ marker: line.marker, note: line.note })),
  })),
  edgeChanges: {
    added: [...review.edgeChanges.added],
    removed: [...review.edgeChanges.removed],
  },
  ruleViolations: violations.map((violation) => ({
    ruleId: violation.ruleId,
    message: violation.message,
    filePaths: [...violation.evidence.filePaths],
    ...(violation.evidence.edgeId === undefined ? {} : { edgeId: violation.evidence.edgeId }),
  })),
  discrepanciesFound: hasDiscrepancies(review) || violations.length > 0,
});

/**
 * §24.1: mark findings that carry an accepted-deviation decision with the recorded reason.
 * Findings are never rewritten or recategorized — the mark rides alongside; the report
 * renders marked findings in the Accepted Deviations section (§38.2).
 */
export const applyAcceptedDeviations = (
  document: CliReviewOutput,
  deviations: readonly AcceptedDeviationDto[],
): CliReviewOutput => ({
  ...document,
  findings: document.findings.map((finding) => {
    const decision = deviations.find(
      (candidate) => candidate.nodeId === finding.nodeId && candidate.category === finding.category,
    );
    return decision === undefined
      ? finding
      : { ...finding, acceptedDeviation: { reason: decision.reason } };
  }),
});
