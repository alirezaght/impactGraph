import { isBlocking } from './preflight-finding.js';

import type { PreflightFinding, PreflightFindingKind } from './preflight-finding.js';
import type { RequirementClassification } from './requirement-classification.js';

/**
 * The primary result of a preflight analysis.
 *
 * `readiness: 87` is too easy to misread — it invites "87 is pretty good, ship it" when the missing
 * 13 was a hard architectural violation. The score is kept, because a monotone figure is genuinely
 * useful for tracking a specification as it is refined, but it is demoted to a secondary field and
 * the decision is stated in words.
 */
export const FEASIBILITIES = [
  'READY',
  'READY_WITH_WARNINGS',
  'NEEDS_CLARIFICATION',
  'INSUFFICIENT_COVERAGE',
  'BLOCKED',
] as const;

export type Feasibility = (typeof FEASIBILITIES)[number];

export interface PlanAssessmentCounts {
  readonly blockingViolations: number;
  readonly invalidAssumptions: number;
  readonly runtimeTopologyGaps: number;
  readonly configSemanticsRisks: number;
  readonly newSurfaces: number;
  readonly coverageGaps: number;
  readonly unresolvedArchitecturalQuestions: number;
  readonly constraintWarnings: number;
  readonly missingConsumers: number;
  readonly expectedChangeSurfaces: number;
}

export interface PlanAssessment {
  readonly feasibility: Feasibility;
  readonly counts: PlanAssessmentCounts;
  /** One sentence a reader can act on without opening anything else. */
  readonly decision: string;
  /** The finding ids that drove the verdict, strongest first. */
  readonly decidingFindingIds: readonly string[];
  /**
   * The retained 0–100 figure. Secondary on purpose: useful for tracking a specification across
   * revisions, never the headline.
   */
  readonly score?: number;
  /**
   * Withheld when coverage is insufficient. A score computed over a graph missing the feature's
   * code would be a confident number about nothing.
   */
  readonly scoreWithheldReason?: string;
}

export interface AssessmentInput {
  readonly findings: readonly PreflightFinding[];
  readonly classifications: readonly RequirementClassification[];
  /** Requirements with at least one structural impact — the positive half of the picture. */
  readonly expectedChangeSurfaces: number;
  /** Open blocking clarification questions, from the existing clarification engine. */
  readonly blockingQuestions: number;
  /** True when workspace coverage was judged insufficient by the existing coverage rules. */
  readonly coverageInsufficient: boolean;
  /** The readiness figure the existing deterministic calculation produced, when available. */
  readonly score?: number;
}

const countOf = (findings: readonly PreflightFinding[], kind: PreflightFindingKind): number =>
  findings.filter((finding) => finding.kind === kind).length;

const buildCounts = (input: AssessmentInput): PlanAssessmentCounts => ({
  blockingViolations: input.findings.filter(
    (finding) => finding.kind === 'blocking-constraint-violation' && isBlocking(finding),
  ).length,
  invalidAssumptions: countOf(input.findings, 'invalid-assumption'),
  runtimeTopologyGaps: countOf(input.findings, 'runtime-topology-gap'),
  configSemanticsRisks: countOf(input.findings, 'config-semantics-risk'),
  newSurfaces: countOf(input.findings, 'new-surface'),
  coverageGaps: countOf(input.findings, 'coverage-gap'),
  unresolvedArchitecturalQuestions: countOf(input.findings, 'unresolved-architectural-question'),
  constraintWarnings: countOf(input.findings, 'constraint-warning'),
  missingConsumers: countOf(input.findings, 'missing-consumer'),
  expectedChangeSurfaces: input.expectedChangeSurfaces,
});

const blockingFindings = (findings: readonly PreflightFinding[]): readonly PreflightFinding[] =>
  findings.filter(isBlocking);

/**
 * Precedence, in order, and why:
 *
 * BLOCKED first — a hard invariant violation is decisive whatever else is true. The motivating
 * failure had excellent structural coverage and was still unimplementable as designed, so coverage
 * must not be able to outrank it.
 *
 * INSUFFICIENT_COVERAGE next — below a real violation, but above every judgment that depends on
 * having searched the right code, because those judgments are unfounded without it.
 */
const decide = (
  input: AssessmentInput,
  counts: PlanAssessmentCounts,
): { feasibility: Feasibility; decision: string } => {
  const blocking = blockingFindings(input.findings);
  if (blocking.length > 0) {
    const first = blocking[0];
    return {
      feasibility: 'BLOCKED',
      decision: `Do not implement yet. ${String(blocking.length)} blocking finding(s): ${first?.statement ?? ''}`,
    };
  }
  if (input.coverageInsufficient) {
    return {
      feasibility: 'INSUFFICIENT_COVERAGE',
      decision:
        'Coverage is insufficient to assess this plan — index or register the missing repositories, then re-run. Findings below are scoped to what was indexed.',
    };
  }
  if (input.blockingQuestions > 0 || counts.unresolvedArchitecturalQuestions > 0) {
    const open = input.blockingQuestions + counts.unresolvedArchitecturalQuestions;
    return {
      feasibility: 'NEEDS_CLARIFICATION',
      decision: `Resolve ${String(open)} open architectural question(s) before implementing — the answers change what has to be built.`,
    };
  }
  const warnings =
    counts.constraintWarnings +
    counts.runtimeTopologyGaps +
    counts.invalidAssumptions +
    counts.configSemanticsRisks +
    counts.missingConsumers +
    counts.coverageGaps;
  if (warnings > 0) {
    return {
      feasibility: 'READY_WITH_WARNINGS',
      decision: `Implementable, with ${String(warnings)} warning(s) to read first — none of them blocks on its own.`,
    };
  }
  return {
    feasibility: 'READY',
    decision:
      counts.newSurfaces > 0
        ? `Implementable. ${String(counts.newSurfaces)} requirement(s) create new surface, and ${String(counts.expectedChangeSurfaces)} existing surface(s) are expected to change.`
        : `Implementable. ${String(counts.expectedChangeSurfaces)} expected change surface(s).`,
  };
};

const decidingIds = (input: AssessmentInput, feasibility: Feasibility): readonly string[] => {
  if (feasibility === 'BLOCKED') {
    return blockingFindings(input.findings).map((finding) => finding.id);
  }
  return input.findings
    .filter((finding) => finding.severity === 'warning')
    .slice(0, 10)
    .map((finding) => finding.id);
};

/**
 * Deterministic: the same inputs always produce the same assessment. Never a model's judgment.
 */
export const assessPlan = (input: AssessmentInput): PlanAssessment => {
  const counts = buildCounts(input);
  const { feasibility, decision } = decide(input, counts);
  const scoreBlock =
    feasibility === 'INSUFFICIENT_COVERAGE' || input.score === undefined
      ? {
          scoreWithheldReason:
            feasibility === 'INSUFFICIENT_COVERAGE'
              ? 'Repository coverage is insufficient — a score over a graph missing the feature’s code would be misleading.'
              : 'No deterministic score was supplied for this analysis.',
        }
      : { score: input.score };
  return {
    feasibility,
    counts,
    decision,
    decidingFindingIds: decidingIds(input, feasibility),
    ...scoreBlock,
  };
};
