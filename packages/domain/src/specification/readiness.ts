import type { Specification } from './specification.js';

// Story 15.6 — implementation readiness (PRD §C10). A deterministic function over the
// specification state; never a number a model returns. Weights are documented here and the
// same inputs always produce the same score.

export interface ReadinessReport {
  /** 0–100. */
  readonly score: number;
  readonly blockingQuestions: number;
  readonly importantQuestions: number;
  readonly minorQuestions: number;
  /**
   * Requirements the impact analysis could not tie to a single repository component. Absent when
   * no coverage was supplied — 0 would assert full coverage that was never measured.
   */
  readonly unmatchedRequirements?: number;
  readonly recommendedAction: string;
}

/**
 * Analysis coverage, supplied by the caller that holds the impact model. Readiness stays a pure
 * function of state: a requirement no component answers is not implementable, however few open
 * questions remain, so the score may not read 100 while coverage is incomplete.
 */
export interface ReadinessCoverage {
  readonly unmatchedRequirementIds: readonly string[];
}

const PENALTY = { blocking: 25, important: 7, minor: 2 } as const;

/** Full penalty when nothing matched, pro-rata otherwise. */
const COVERAGE_PENALTY = 50;

interface Counts {
  readonly blocking: number;
  readonly important: number;
  readonly minor: number;
  readonly unmatched: number;
}

const recommendedAction = ({ blocking, important, minor, unmatched }: Counts): string => {
  if (blocking > 0) {
    return `Answer the ${String(blocking)} blocking question(s) before implementation.`;
  }
  if (unmatched > 0) {
    return `${String(unmatched)} requirement(s) match no component — name the intended components or index the missing part of the repository.`;
  }
  if (important > 0) {
    return `Consider answering the ${String(important)} important question(s) first.`;
  }
  if (minor > 0) {
    return `Ready — ${String(minor)} minor question(s) remain.`;
  }
  return 'Ready for implementation.';
};

export const computeReadiness = (
  specification: Specification,
  coverage?: ReadinessCoverage,
): ReadinessReport => {
  if (specification.requirements.length === 0) {
    return {
      score: 0,
      blockingQuestions: 0,
      importantQuestions: 0,
      minorQuestions: 0,
      recommendedAction: 'No requirements extracted yet — the specification needs requirements.',
    };
  }
  const requirementIds = new Set(specification.requirements.map((requirement) => requirement.id));
  const unmatched = new Set(
    (coverage?.unmatchedRequirementIds ?? []).filter((id) => requirementIds.has(id)),
  ).size;
  const open = specification.openQuestions.filter((question) => question.status === 'open');
  const counts: Counts = {
    blocking: open.filter((question) => question.severity === 'blocking').length,
    important: open.filter((question) => question.severity === 'important').length,
    minor: open.filter((question) => question.severity === 'minor').length,
    unmatched,
  };
  const penalty =
    counts.blocking * PENALTY.blocking +
    counts.important * PENALTY.important +
    counts.minor * PENALTY.minor +
    Math.round((COVERAGE_PENALTY * unmatched) / requirementIds.size);
  return {
    score: Math.max(5, 100 - penalty),
    blockingQuestions: counts.blocking,
    importantQuestions: counts.important,
    minorQuestions: counts.minor,
    ...(coverage === undefined ? {} : { unmatchedRequirements: unmatched }),
    recommendedAction: recommendedAction(counts),
  };
};
