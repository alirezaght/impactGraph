import { findingOriginOf, isBlocking, isPlanFinding, verificationOf } from './preflight-finding.js';

import type { FindingOrigin, PreflightFinding, PreflightFindingKind } from './preflight-finding.js';
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
  /**
   * Something the specification assumes could not be established from the indexed structure.
   * Distinct from BLOCKED on purpose: "I could not prove your plan is right" is not "I found
   * evidence your plan is wrong", and collapsing the two teaches readers to override the gate.
   */
  'NEEDS_VERIFICATION',
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
  /**
   * ADR-0020 §4 — SQL in the plan comparing a type-sensitive column against bound parameters.
   * Optional because the slot is additive: older assessments simply never counted it.
   */
  readonly typeSensitiveComparisons?: number;
  readonly expectedChangeSurfaces: number;
  /**
   * Findings that could not be established rather than disproved. They ask for investigation and
   * never for a stop. Additive: older assessments never separated them.
   */
  readonly unverifiedAssumptions?: number;
  /**
   * Limits of ImpactGraph's own model, index or resolution. Reported beside the plan's findings,
   * never counted among them — a caveat about our reach is not evidence about the design.
   */
  readonly analysisCaveats?: number;
  /** Pre-existing repository conditions the change neither caused nor specifically touches. */
  readonly backgroundConditions?: number;
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
  /**
   * Set when the verdict forced the score down. The pair (readiness 94, feasibility BLOCKED) was
   * shipped to a user: both halves were internally defensible and together they were nonsense.
   * The verdict is authoritative, so the score is reconciled to it and says why.
   */
  readonly scoreCappedReason?: string;
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
  /**
   * Why the caller withheld the score when it deliberately computed none (provisional extraction,
   * insufficient coverage). Threading the real reason stops the generic "no score was supplied"
   * from masking a withholding decision the caller already explained elsewhere.
   */
  readonly scoreWithheldReason?: string;
}

/**
 * Counts describe the PLAN, so they are taken over plan findings only. Counting a caveat about
 * our own reach here is what made an unresolved Terraform expression read as a risk the change
 * introduced — once per requirement.
 */
const countOf = (findings: readonly PreflightFinding[], kind: PreflightFindingKind): number =>
  findings.filter((finding) => finding.kind === kind && isPlanFinding(finding)).length;

const originCount = (findings: readonly PreflightFinding[], origin: FindingOrigin): number =>
  findings.filter((finding) => findingOriginOf(finding) === origin).length;

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
  typeSensitiveComparisons: countOf(input.findings, 'type-sensitive-comparison'),
  expectedChangeSurfaces: input.expectedChangeSurfaces,
  unverifiedAssumptions: input.findings.filter(
    (finding) =>
      isPlanFinding(finding) &&
      verificationOf(finding) === 'unverified-assumption' &&
      UNVERIFIABLE_KINDS.includes(finding.kind),
  ).length,
  analysisCaveats: originCount(input.findings, 'analysis-caveat'),
  backgroundConditions: originCount(input.findings, 'background-condition'),
});

/**
 * Kinds whose unverified form is a question about the SPECIFICATION — "does this thing exist,
 * does this path carry that config" — as opposed to a planning fact (new surface, coverage gap)
 * that no amount of verification would turn into a defect.
 */
const UNVERIFIABLE_KINDS: readonly PreflightFindingKind[] = [
  'invalid-assumption',
  'runtime-topology-gap',
  'blocking-constraint-violation',
];

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
/** The two positive outcomes, split out so the precedence ladder above stays readable. */
const decideWithoutProblems = (
  counts: PlanAssessmentCounts,
): { feasibility: Feasibility; decision: string } => {
  const warnings =
    counts.constraintWarnings +
    counts.runtimeTopologyGaps +
    counts.invalidAssumptions +
    counts.configSemanticsRisks +
    counts.missingConsumers +
    (counts.typeSensitiveComparisons ?? 0) +
    counts.coverageGaps -
    (counts.unverifiedAssumptions ?? 0);
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
  if ((counts.unverifiedAssumptions ?? 0) > 0) {
    const unverified = counts.unverifiedAssumptions ?? 0;
    return {
      feasibility: 'NEEDS_VERIFICATION',
      decision: `No verified contradiction was found, but ${String(unverified)} specification assumption(s) could not be verified from the indexed structure. Check them before implementing — this is not evidence that they are false.`,
    };
  }
  if (input.blockingQuestions > 0 || counts.unresolvedArchitecturalQuestions > 0) {
    const open = input.blockingQuestions + counts.unresolvedArchitecturalQuestions;
    return {
      feasibility: 'NEEDS_CLARIFICATION',
      decision: `Resolve ${String(open)} open architectural question(s) before implementing — the answers change what has to be built.`,
    };
  }
  return decideWithoutProblems(counts);
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
 * The highest readiness each verdict can honestly carry.
 *
 * The score answers "how few open questions are left"; the verdict answers "is this safe to act
 * on". They are different measurements, which is why they could disagree — and a reader shown
 * `readiness 94` beside `BLOCKED` cannot tell which one to believe. The verdict is authoritative,
 * so the score is reconciled DOWN to it rather than the disagreement being explained in prose.
 * Reconciling rather than zeroing keeps the figure useful for tracking a specification across
 * revisions, which is the only reason it exists.
 */
const SCORE_CEILING: Readonly<Record<Feasibility, number>> = {
  READY: 100,
  READY_WITH_WARNINGS: 100,
  NEEDS_VERIFICATION: 70,
  NEEDS_CLARIFICATION: 60,
  INSUFFICIENT_COVERAGE: 40,
  BLOCKED: 20,
};

export const reconciledScore = (
  score: number,
  feasibility: Feasibility,
): { score: number; scoreCappedReason?: string } => {
  const ceiling = SCORE_CEILING[feasibility];
  if (score <= ceiling) {
    return { score };
  }
  return {
    score: ceiling,
    scoreCappedReason: `The question-based readiness figure was ${String(score)}, which cannot stand beside a ${feasibility} verdict — the verdict is the authoritative answer and the score is reported at its ceiling.`,
  };
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
              : (input.scoreWithheldReason ??
                'No deterministic score was supplied for this analysis.'),
        }
      : reconciledScore(input.score, feasibility);
  return {
    feasibility,
    counts,
    decision,
    decidingFindingIds: decidingIds(input, feasibility),
    ...scoreBlock,
  };
};
