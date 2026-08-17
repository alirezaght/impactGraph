import { isPlanFinding } from '@impactgraph/domain';

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
  ...(finding.verification === undefined ? {} : { verification: finding.verification }),
  ...(finding.origin === undefined ? {} : { origin: finding.origin }),
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
  ...(outcome.assessment.scoreCappedReason === undefined
    ? {}
    : { scoreCappedReason: outcome.assessment.scoreCappedReason }),
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

/**
 * How many coverage-gap findings the slice carries (ADR-0022).
 *
 * A coverage gap says "this requirement matched nothing", which `unmatchedRequirements` already
 * states for every requirement. On a prose specification they filled the whole budget — seven
 * near-identical warnings crowded out the one invalid assumption a reader had to act on. The rest
 * are counted, not printed, and remain in list_preflight_findings.
 */
const COVERAGE_GAP_SLICE = 3;

/**
 * Findings already arrive strongest-first, so the head of the list is the decisive slice — but
 * one repetitive kind must not evict the distinct ones behind it.
 */
/**
 * ADR-0023: the red-team slice carries findings against the PLAN. A caveat about ImpactGraph's own
 * reach is reported beside them (`analysisCaveats`), never among them — mixing the two is what let
 * an unresolved Terraform expression read as a risk the specification introduced.
 */
export const analysisCaveats = (
  outcome: PreflightOutcome,
  limit = CAVEAT_LIMIT,
): readonly PreflightFindingDto[] =>
  outcome.findings
    .filter((finding) => !isPlanFinding(finding))
    .slice(0, limit)
    .map(toFindingDto);

/** Caveats are context, not work: a handful is orientation, a page of them is noise. */
const CAVEAT_LIMIT = 5;

export const summaryFindings = (
  outcome: PreflightOutcome,
  limit = SUMMARY_FINDING_LIMIT,
): readonly PreflightFindingDto[] => {
  const kept: PreflightFinding[] = [];
  let coverageGaps = 0;
  for (const finding of outcome.findings.filter(isPlanFinding)) {
    if (kept.length >= limit) {
      break;
    }
    if (finding.kind === 'coverage-gap') {
      coverageGaps += 1;
      if (coverageGaps > COVERAGE_GAP_SLICE) {
        continue;
      }
    }
    kept.push(finding);
  }
  return kept.map(toFindingDto);
};

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
