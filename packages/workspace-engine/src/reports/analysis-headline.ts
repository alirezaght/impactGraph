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
  READY_WITH_WARNINGS: 'READY WITH WARNINGS',
  NEEDS_CLARIFICATION: 'NEEDS CLARIFICATION',
  INSUFFICIENT_COVERAGE: 'INSUFFICIENT COVERAGE',
  BLOCKED: 'BLOCKED',
};

const capitalize = (value: string): string =>
  value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;

const plural = (count: number, singular: string, suffix = 's'): string =>
  `${String(count)} ${singular}${count === 1 ? '' : suffix}`;

/** Risks a reader must personally settle before starting: assumptions, constraints, topology. */
const riskCount = (assessment: PlanAssessmentDto): number =>
  assessment.counts.blockingViolations +
  assessment.counts.invalidAssumptions +
  assessment.counts.runtimeTopologyGaps +
  assessment.counts.configSemanticsRisks +
  assessment.counts.constraintWarnings;

/**
 * ADR-0023: whether the analysis found reason to look further than the code that changes.
 *
 * Derived from the surfaces the summary already shows, so it states what the reader can verify in
 * the same document. Saying so matters: a small, well-contained change deserves "this looks local"
 * rather than an implied promise that a large analysis was necessary.
 */
const FAR_REACHING_BASES = new Set(['async-event', 'external-contract', 'configuration-asset']);

const topLevelOf = (path: string): string => path.split('/').slice(0, 2).join('/');

const containmentNote = (topImpacts: CliImpactSummary['topImpacts']): string | undefined => {
  const strong = topImpacts.filter(
    (impact) => impact.likelihood === 'required' || impact.likelihood === 'likely',
  );
  if (strong.length === 0) {
    return undefined;
  }
  if (strong.some((impact) => FAR_REACHING_BASES.has(impact.evidenceType))) {
    return undefined;
  }
  const components = new Set(
    strong.map((impact) => topLevelOf(impact.path ?? impact.nodeId)).filter((part) => part !== ''),
  );
  return components.size === 1 ? 'The change looks local and well contained' : undefined;
};

export interface HeadlineInput {
  readonly assessment?: PlanAssessmentDto | undefined;
  readonly independence?: EvidenceIndependenceDto | undefined;
  /** Surfaces shown by the default view — the strong tier, not the raw impact total. */
  readonly strongSurfaceCount: number;
  /** The shown surfaces themselves, so the headline can say whether the change looks contained. */
  readonly topImpacts: CliImpactSummary['topImpacts'];
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
  // "READY WITH WARNINGS" and no risk count would leave the reader hunting for the warnings, so
  // the risk count is stated whenever there is one.
  const parts = [risks === 0 ? verdict : `${verdict} — ${plural(risks, 'risk')} to verify`];
  const split = independenceSplit(input);
  const surfaces = capitalize(
    `${plural(input.strongSurfaceCount, 'change surface')} on strong evidence`,
  );
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
  parts.push(gaps.length === 0 ? 'No known coverage gaps' : capitalize(gaps.join(', ')));
  const containment = containmentNote(input.topImpacts);
  if (containment !== undefined) {
    parts.push(containment);
  }
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
