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
  readonly recommendedAction: string;
}

const PENALTY = { blocking: 25, important: 7, minor: 2 } as const;

const recommendedAction = (blocking: number, important: number, minor: number): string => {
  if (blocking > 0) {
    return `Answer the ${String(blocking)} blocking question(s) before implementation.`;
  }
  if (important > 0) {
    return `Consider answering the ${String(important)} important question(s) first.`;
  }
  if (minor > 0) {
    return `Ready — ${String(minor)} minor question(s) remain.`;
  }
  return 'Ready for implementation.';
};

export const computeReadiness = (specification: Specification): ReadinessReport => {
  if (specification.requirements.length === 0) {
    return {
      score: 0,
      blockingQuestions: 0,
      importantQuestions: 0,
      minorQuestions: 0,
      recommendedAction: 'No requirements extracted yet — the specification needs requirements.',
    };
  }
  const open = specification.openQuestions.filter((question) => question.status === 'open');
  const blocking = open.filter((question) => question.severity === 'blocking').length;
  const important = open.filter((question) => question.severity === 'important').length;
  const minor = open.filter((question) => question.severity === 'minor').length;
  const penalty =
    blocking * PENALTY.blocking + important * PENALTY.important + minor * PENALTY.minor;
  return {
    score: Math.max(5, 100 - penalty),
    blockingQuestions: blocking,
    importantQuestions: important,
    minorQuestions: minor,
    recommendedAction: recommendedAction(blocking, important, minor),
  };
};
