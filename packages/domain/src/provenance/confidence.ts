import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';

// PRD §14 — confidence is computed from weighted deterministic signals, never asserted by a
// model. The domain type enforces shape only; the weighting engine is Epic 06.
export const CONFIDENCE_SIGNAL_TYPES = [
  // direct-observation: the fact was parsed directly from the source (deterministic facts,
  // confidence 1.0). The PRD's signal list is explicitly non-exhaustive ("Potential signals").
  'direct-observation',
  'exact-concept-to-symbol-match',
  // container-name-match: the concept names a container-kind node (package, workspace,
  // repository, directory) by NAME. Naming the box is not naming a change surface inside it —
  // a product name matching its own package once anchored required/0.9 impacts — so this signal
  // is deliberately weaker than an identifier-grade match.
  'container-name-match',
  // basename-file-match: the concept is a bare filename (extension, no '/') that matched a file
  // by basename alone. The specification did not say WHICH file of that name, so the signal is
  // weaker than a path-qualified or verbatim match.
  'basename-file-match',
  'semantic-concept-match',
  'direct-import',
  'direct-function-call',
  'direct-data-access',
  'api-ownership',
  'event-relationship',
  'shared-bounded-context',
  'framework-convention',
  'historical-co-change',
  'test-association',
  'documentation-match',
  'human-confirmed-mapping',
  'graph-distance',
  'ambiguity',
  'conflicting-evidence',
  'unsupported-inference',
  // test-only-match: the concept resolved only to test artifacts. Test doubles mirror the
  // production interfaces they stand in for, so they collide by name with the concepts a
  // specification names — while never being the thing that has to change.
  'test-only-match',
] as const;

export type ConfidenceSignalType = (typeof CONFIDENCE_SIGNAL_TYPES)[number];

/** Penalty signals — their contributions may never be positive. */
export const PENALTY_SIGNAL_TYPES = [
  'graph-distance',
  'ambiguity',
  'conflicting-evidence',
  'unsupported-inference',
  'test-only-match',
] as const satisfies readonly ConfidenceSignalType[];

export interface ConfidenceSignal {
  readonly type: ConfidenceSignalType;
  readonly contribution: number;
  readonly description?: string;
}

export interface ConfidenceScore {
  readonly value: number;
  readonly signals: readonly ConfidenceSignal[];
}

export interface ConfidenceSignalInput {
  readonly type: string;
  readonly contribution: number;
  readonly description?: string;
}

export interface ConfidenceScoreInput {
  readonly value: number;
  readonly signals: readonly ConfidenceSignalInput[];
}

const isSignalType = (value: string): value is ConfidenceSignalType =>
  (CONFIDENCE_SIGNAL_TYPES as readonly string[]).includes(value);

const isPenalty = (type: ConfidenceSignalType): boolean =>
  (PENALTY_SIGNAL_TYPES as readonly string[]).includes(type);

const signalIssues = (signal: ConfidenceSignalInput, path: string): ValidationIssue[] => {
  if (!isSignalType(signal.type)) {
    return [validationIssue('unknown-signal', path, `unknown confidence signal '${signal.type}'`)];
  }
  if (!Number.isFinite(signal.contribution)) {
    return [validationIssue('out-of-range', path, 'signal contribution must be a finite number')];
  }
  if (isPenalty(signal.type) && signal.contribution > 0) {
    return [
      validationIssue('wrong-sign-signal', path, `penalty '${signal.type}' must contribute <= 0`),
    ];
  }
  if (!isPenalty(signal.type) && signal.contribution < 0) {
    return [
      validationIssue('wrong-sign-signal', path, `signal '${signal.type}' must contribute >= 0`),
    ];
  }
  return [];
};

export const collectConfidenceIssues = (
  input: ConfidenceScoreInput,
  path: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1) {
    issues.push(validationIssue('out-of-range', `${path}.value`, 'confidence must be within 0..1'));
  }
  if (input.signals.length === 0) {
    issues.push(
      validationIssue(
        'missing-signals',
        `${path}.signals`,
        'confidence requires at least one contributing signal (PRD §14)',
      ),
    );
  }
  input.signals.forEach((signal, index) => {
    issues.push(...signalIssues(signal, `${path}.signals[${index}]`));
  });
  return issues;
};

/** Assumes the input already passed collectConfidenceIssues. */
export const buildConfidenceScore = (input: ConfidenceScoreInput): ConfidenceScore =>
  deepFreeze({
    value: input.value,
    signals: input.signals.map((signal) => {
      const base = { type: signal.type as ConfidenceSignalType, contribution: signal.contribution };
      return signal.description === undefined ? base : { ...base, description: signal.description };
    }),
  });

export const createConfidenceScore = (
  value: number,
  signals: readonly ConfidenceSignalInput[],
): Result<ConfidenceScore, ValidationError> => {
  const issues = collectConfidenceIssues({ value, signals }, 'confidence');
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(buildConfidenceScore({ value, signals }));
};
