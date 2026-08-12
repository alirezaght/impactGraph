import type { PreflightOutcome } from '../preflight.js';
import type {
  ConstraintSummaryDto,
  EvidenceIndependenceDto,
  PlanAssessmentDto,
  PreflightFindingDto,
  RequirementClassificationDto,
} from '@impactgraph/contracts';
import type { PreflightFinding, RepositoryConstraint } from '@impactgraph/domain';

/**
 * Map the preflight outcome onto the wire contract, bounded.
 *
 * Bounded is the operative word. The previous index call returned 792 raw warning strings and blew
 * the consumer's token limit outright; a findings list is exactly the same hazard. The summary
 * carries the findings that DECIDE the verdict and says how many it withheld, and the full set is
 * one paged call away.
 */

/** How many findings a summary carries. Enough to see the decision, not enough to bury it. */
export const SUMMARY_FINDING_LIMIT = 12;

export const toFindingDto = (finding: PreflightFinding): PreflightFindingDto => ({
  id: finding.id,
  kind: finding.kind,
  severity: finding.severity,
  requirementIds: [...finding.requirementIds],
  statement: finding.statement,
  recommendation: finding.recommendation,
  confidence: finding.confidence,
  analyzer: finding.analyzer,
  ...(finding.subject.constraintId === undefined
    ? {}
    : { constraintId: finding.subject.constraintId }),
  ...(finding.subject.proposedRelationship === undefined
    ? {}
    : { proposedRelationship: { ...finding.subject.proposedRelationship } }),
  ...(finding.subject.runtimePathId === undefined
    ? {}
    : { runtimePathId: finding.subject.runtimePathId }),
  ...(finding.subject.assumedSymbol === undefined
    ? {}
    : { assumedSymbol: finding.subject.assumedSymbol }),
  ...(finding.subject.nodeIds === undefined ? {} : { nodeIds: [...finding.subject.nodeIds] }),
  ...(finding.subject.filePaths === undefined ? {} : { filePaths: [...finding.subject.filePaths] }),
});

export const toAssessmentDto = (outcome: PreflightOutcome): PlanAssessmentDto => ({
  feasibility: outcome.assessment.feasibility,
  decision: outcome.assessment.decision,
  counts: { ...outcome.assessment.counts },
  decidingFindingIds: [...outcome.assessment.decidingFindingIds],
  ...(outcome.assessment.score === undefined ? {} : { score: outcome.assessment.score }),
  ...(outcome.assessment.scoreWithheldReason === undefined
    ? {}
    : { scoreWithheldReason: outcome.assessment.scoreWithheldReason }),
});

export const toClassificationDtos = (
  outcome: PreflightOutcome,
): readonly RequirementClassificationDto[] =>
  outcome.classifications.map((entry) => ({
    requirementId: entry.requirementId,
    classification: entry.classification,
    rationale: entry.rationale,
    confidence: entry.confidence,
  }));

export const toIndependenceDto = (outcome: PreflightOutcome): EvidenceIndependenceDto => ({
  ...outcome.independence,
});

/** Findings already arrive strongest-first, so the head of the list is the decisive slice. */
export const summaryFindings = (
  outcome: PreflightOutcome,
  limit = SUMMARY_FINDING_LIMIT,
): readonly PreflightFindingDto[] => outcome.findings.slice(0, limit).map(toFindingDto);

export const toConstraintSummary = (constraint: RepositoryConstraint): ConstraintSummaryDto => ({
  id: constraint.id,
  name: constraint.name,
  kind: constraint.kind,
  severity: constraint.severity,
  extraction: constraint.extraction,
  statement: constraint.rule.statement,
  sourcePath: constraint.source.filePath,
  scopeGlobs: [...constraint.scope.pathGlobs],
  exemptionCount: constraint.exemptions.length,
  ...(constraint.notExtractedReason === undefined
    ? {}
    : { notExtractedReason: constraint.notExtractedReason }),
});
