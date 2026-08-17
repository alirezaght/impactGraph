/**
 * The decision-first head of the analysis document (ADR-0022, ADR-0023).
 *
 * Assembled apart from the rest so the ordering that puts the verdict, its evidence-independence
 * split and the one-sentence headline BEFORE the evidence is visible in one place — and so the
 * separation between findings against the plan and caveats about ImpactGraph's own reach is made
 * exactly once.
 */

import { buildHeadline, strongSurfaceCount } from './analysis-headline.js';
import {
  analysisCaveats,
  summaryFindings,
  toAssessmentDto,
  toIndependenceDto,
} from './preflight-block.js';

import type { ImpactSummaryInput } from './impact-summary.js';
import type { CliImpactSummary } from '@impactgraph/contracts';

const preflightBlock = (
  input: ImpactSummaryInput,
): Pick<
  CliImpactSummary,
  | 'planAssessment'
  | 'preflightFindings'
  | 'analysisCaveats'
  | 'evidenceIndependence'
  | 'constraintCoverage'
> => {
  const preflight = input.preflight;
  if (preflight === undefined) {
    return {};
  }
  return {
    planAssessment: toAssessmentDto(preflight),
    preflightFindings: [...summaryFindings(preflight)],
    analysisCaveats: [...analysisCaveats(preflight)],
    evidenceIndependence: toIndependenceDto(preflight),
    constraintCoverage: {
      indexedConstraintCount: preflight.constraintCount,
      opaqueGuardPaths: [...preflight.opaqueGuardPaths],
    },
  };
};

/**
 * ADR-0022 — the decision block: the assessment, its evidence-independence split, and the one
 * sentence that reads them together. Assembled apart from the document so the ordering that puts
 * it first is visible in one place.
 */
interface DecisionFacts {
  readonly topImpacts: CliImpactSummary['topImpacts'];
  readonly unmatchedCount: number;
  readonly unresolvedCount: number;
}

export const decisionBlock = (
  input: ImpactSummaryInput,
  facts: DecisionFacts,
): Partial<CliImpactSummary> => {
  const preflight = preflightBlock(input);
  const headline = buildHeadline({
    assessment: preflight.planAssessment,
    independence: preflight.evidenceIndependence,
    strongSurfaceCount: strongSurfaceCount(facts.topImpacts),
    topImpacts: facts.topImpacts,
    unmatchedRequirementCount: facts.unmatchedCount,
    unresolvedConceptCount: facts.unresolvedCount,
  });
  return { ...preflight, ...(headline === undefined ? {} : { headline }) };
};

export const analysisBlock = (
  analysis: ImpactSummaryInput['analysis'],
  reasons: readonly string[],
): CliImpactSummary['analysis'] => ({
  id: analysis.id,
  snapshotId: analysis.repositorySnapshotId,
  status: analysis.status,
  provisional: reasons.length > 0,
  provisionalReasons: [...reasons],
});

