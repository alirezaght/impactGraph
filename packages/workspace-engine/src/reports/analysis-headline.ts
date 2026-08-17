/**
 * The analysis in one sentence (ADR-0022).
 *
 * `planAssessment` already carried the verdict, but a reader had to assemble the actual situation
 * from counts spread across five blocks — and the impact total, dominated by weak name matches,
 * was the number that caught the eye. This states what a reader needs to decide whether to start:
 * the verdict, how many change surfaces rest on STRONG evidence, how many of those the
 * specification supplied versus ImpactGraph corroborated independently, and what is unresolved.
 *
 * Every number comes from a block already in the document. The headline never says anything the
 * detail does not, so it can be trusted as a summary rather than a second opinion.
 */

import type {
  EvidenceIndependenceDto,
  PlanAssessmentDto,
  CliImpactSummary,
} from '@impactgraph/contracts';

const VERDICT_PHRASES: Readonly<Record<string, string>> = {
  READY: 'READY',
  READY_WITH_WARNINGS: 'READY WITH RISKS',
  NEEDS_CLARIFICATION: 'NEEDS CLARIFICATION',
  INSUFFICIENT_COVERAGE: 'INSUFFICIENT COVERAGE',
  BLOCKED: 'BLOCKED',
};

const plural = (count: number, singular: string, suffix = 's'): string =>
  `${String(count)} ${singular}${count === 1 ? '' : suffix}`;

/** Risks a reader must personally settle before starting: assumptions, constraints, topology. */
const riskCount = (assessment: PlanAssessmentDto): number =>
  assessment.counts.blockingViolations +
  assessment.counts.invalidAssumptions +
  assessment.counts.runtimeTopologyGaps +
  assessment.counts.configSemanticsRisks +
  assessment.counts.constraintWarnings;

export interface HeadlineInput {
  readonly assessment?: PlanAssessmentDto | undefined;
  readonly independence?: EvidenceIndependenceDto | undefined;
  /** Surfaces shown by the default view — the strong tier, not the raw impact total. */
  readonly strongSurfaceCount: number;
  readonly unmatchedRequirementCount: number;
  readonly unresolvedConceptCount: number;
}

/**
 * `evidenceIndependence` counts IMPACTS across every tier; the headline speaks about the surfaces
 * a reader will actually look at. Scaling the ratio keeps the two consistent instead of quoting a
 * confirmation count larger than the surface count it describes.
 */
const independenceSplit = (
  input: HeadlineInput,
): { supplied: number; corroborated: number } | undefined => {
  const independence = input.independence;
  if (independence === undefined || input.strongSurfaceCount === 0) {
    return undefined;
  }
  const classified = independence.independentCount + independence.confirmationCount;
  if (classified === 0) {
    return undefined;
  }
  const supplied = Math.min(
    input.strongSurfaceCount,
    Math.round((independence.confirmationCount / classified) * input.strongSurfaceCount),
  );
  return { supplied, corroborated: input.strongSurfaceCount - supplied };
};

export const buildHeadline = (input: HeadlineInput): string | undefined => {
  const assessment = input.assessment;
  if (assessment === undefined) {
    return undefined;
  }
  const verdict = VERDICT_PHRASES[assessment.feasibility] ?? assessment.feasibility;
  const risks = riskCount(assessment);
  const parts = [risks === 0 ? verdict : `${verdict} — ${plural(risks, 'risk')} to verify`];
  const split = independenceSplit(input);
  const surfaces = `${plural(input.strongSurfaceCount, 'change surface')} on strong evidence`;
  parts.push(
    split === undefined
      ? surfaces
      : `${surfaces} (${String(split.supplied)} supplied by the specification, ${String(split.corroborated)} independently corroborated)`,
  );
  const gaps: string[] = [];
  if (input.unmatchedRequirementCount > 0) {
    gaps.push(`${plural(input.unmatchedRequirementCount, 'requirement')} matched nothing`);
  }
  if (input.unresolvedConceptCount > 0) {
    gaps.push(`${plural(input.unresolvedConceptCount, 'named component')} did not resolve`);
  }
  parts.push(gaps.length === 0 ? 'no known coverage gaps' : gaps.join(', '));
  return `${parts.join('. ')}.`;
};

/** The strong tier of the default view: what the reader is being told to look at. */
export const strongSurfaceCount = (topImpacts: CliImpactSummary['topImpacts']): number =>
  topImpacts.filter(
    (impact) =>
      (impact.likelihood === 'required' || impact.likelihood === 'likely') &&
      impact.evidenceType !== 'name-similarity' &&
      impact.evidenceType !== 'lexical-only' &&
      impact.evidenceType !== 'semantic-match',
  ).length;
