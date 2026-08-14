import type {
  ConstraintExemption,
  ConstraintExtraction,
  ConstraintKind,
  ConstraintRule,
  ConstraintScope,
  ConstraintSeverity,
} from '@impactgraph/domain';

/** One file offered to the recognizers. Content is untrusted repository data, never executed. */
export interface GuardFile {
  readonly path: string;
  readonly content: string;
}

/**
 * What a recognizer produces: everything except identity and snapshot binding, which the caller
 * owns. Keeping ids out of recognizers is what lets them stay pure and unit-testable.
 */
export interface ExtractedConstraint {
  readonly name: string;
  readonly kind: ConstraintKind;
  readonly severity: ConstraintSeverity;
  readonly extraction: ConstraintExtraction;
  readonly scope: ConstraintScope;
  readonly rule: ConstraintRule;
  readonly exemptions: readonly Omit<ConstraintExemption, 'source'>[];
  /** Line in the guard where the rule was read, when the recognizer can point at one. */
  readonly sourceLine?: number;
  readonly notExtractedReason?: string;
  /** Which recognizer produced it, so a false positive traces to one file. */
  readonly recognizer: string;
}

/**
 * A recognizer is a pattern matcher over one file, nothing more.
 *
 * The design constraint that matters: adding support for a new guard shape must be adding one file,
 * never editing a growing conditional. No individual repository rule is hardcoded anywhere — a
 * recognizer knows guard *shapes* (a forbidden pattern paired with an allowlist), not guard
 * *instances*.
 */
export interface ConstraintRecognizer {
  readonly id: string;
  /** Cheap path filter, so recognizers do not read files they cannot possibly understand. */
  appliesTo(path: string): boolean;
  recognize(file: GuardFile): readonly ExtractedConstraint[];
}

/** Directories that conventionally hold repository guards. */
const GUARD_DIRECTORY_PATTERNS: readonly RegExp[] = [
  /(^|\/)ci\/(scripts|checks)\//,
  /(^|\/)scripts\/(quality|ci|checks|lint)\//,
  /(^|\/)tools\/(ci|checks)\//,
];

/** Files whose NAME is guard-shaped, wherever they live: `check-*.py` at the repo root. */
const GUARD_NAME_PATTERN =
  /(^|\/)(check|verify|validate|enforce|assert)[-_][\w-]+\.(py|sh|ts|js|mjs)$/;

/** Paths that conventionally hold repository guards. */
export const GUARD_PATH_PATTERNS: readonly RegExp[] = [
  ...GUARD_DIRECTORY_PATTERNS,
  GUARD_NAME_PATTERN,
];

/**
 * Test and fixture material is never a repository guard, whatever it is named: a self-run reported
 * the LOC checker's own `fixtures/over-limit.ts` and `tests/analyzer.test.ts` as opaque guards.
 */
const TEST_OR_FIXTURE_PATH = /(^|\/)(test|tests|__tests__|fixtures)\/|\.(test|spec)\.\w+$/;

/**
 * Product source trees. A guard-shaped NAME under `src/` is application code (the same self-run
 * flagged `packages/application/src/preflight/check-assumptions.ts`); the conventional guard
 * DIRECTORIES stay authoritative wherever they appear.
 */
const SOURCE_TREE_PATH = /(^|\/)src\//;

export const looksLikeGuardPath = (path: string): boolean => {
  if (TEST_OR_FIXTURE_PATH.test(path)) {
    return false;
  }
  if (GUARD_DIRECTORY_PATTERNS.some((pattern) => pattern.test(path))) {
    return true;
  }
  return !SOURCE_TREE_PATH.test(path) && GUARD_NAME_PATTERN.test(path);
};
