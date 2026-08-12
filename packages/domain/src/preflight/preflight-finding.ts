import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue } from '../provenance/evidence.js';
import { isProvenance, knowledgeCategoryOf } from '../provenance/provenance.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { Provenance } from '../provenance/provenance.js';

/**
 * A negative result about a plan.
 *
 * The engine could previously express only "here is a component that will change". It had no way to
 * say "this cannot be built as described". A finding is that second output type: it names something
 * wrong, incomplete, impossible or dangerous, cites what proves it, and states how badly it matters.
 */
export const PREFLIGHT_FINDING_KINDS = [
  /** A requirement proposes a relationship an authoritative repository constraint forbids. */
  'blocking-constraint-violation',
  /** As above, but from a constraint that may not block: opaque guard, model-proposed rule. */
  'constraint-warning',
  /** The runtime path that actually serves this traffic is missing configuration the plan sets. */
  'runtime-topology-gap',
  /** The specification references a symbol, member, route, key or flag that does not exist. */
  'invalid-assumption',
  /** A configuration default is present but semantically means "not configured". */
  'config-semantics-risk',
  /** The requirement creates surface that does not exist yet. Not a defect — a planning fact. */
  'new-surface',
  /** The requirement depends on something outside the indexed scope; it cannot be validated. */
  'coverage-gap',
  /** The plan leaves an architectural choice open that changes what must be built. */
  'unresolved-architectural-question',
  /** Callers or consumers of a changed surface are absent from the plan. */
  'missing-consumer',
  /** A guard governing the changed area was not itself updated. */
  'guard-not-updated',
] as const;

export type PreflightFindingKind = (typeof PREFLIGHT_FINDING_KINDS)[number];

export const isPreflightFindingKind = (value: unknown): value is PreflightFindingKind =>
  typeof value === 'string' && (PREFLIGHT_FINDING_KINDS as readonly string[]).includes(value);

export const FINDING_SEVERITIES = ['blocking', 'warning', 'informational'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * Kinds that may ever be `blocking`. `new-surface` and `coverage-gap` are planning facts, not
 * defects: a plan that creates new surface is normal, and missing coverage is a limit on what can
 * be said, not a verdict on the design.
 */
const BLOCKABLE_KINDS: readonly PreflightFindingKind[] = [
  'blocking-constraint-violation',
  'runtime-topology-gap',
  'invalid-assumption',
];

/** What the finding is about — kept as explicit references, never prose. */
export interface FindingSubject {
  /** Graph nodes the finding concerns. */
  readonly nodeIds?: readonly string[];
  /** The constraint that governs it, when there is one. */
  readonly constraintId?: string;
  /** The relationship the plan proposes, as `source -RELATION-> target`. */
  readonly proposedRelationship?: {
    readonly sourceRef: string;
    readonly relation: string;
    readonly targetRef: string;
  };
  /** A runtime path identifier, when the finding is topological. */
  readonly runtimePathId?: string;
  /** The symbol or member name the specification assumed. */
  readonly assumedSymbol?: string;
  /** File paths a reader should open first. */
  readonly filePaths?: readonly string[];
}

export interface PreflightFinding {
  readonly id: string;
  readonly kind: PreflightFindingKind;
  readonly severity: FindingSeverity;
  readonly requirementIds: readonly string[];
  /** One sentence stating the problem, written for a planner. */
  readonly statement: string;
  /** What a reader should do about it. */
  readonly recommendation: string;
  readonly subject: FindingSubject;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly provenance: Provenance;
  /** The analyzer that produced it, so a false positive can be traced to one place. */
  readonly analyzer: string;
}

const collectIssues = (input: PreflightFinding): ValidationIssue[] => {
  const issues: ValidationIssue[] = [...blankIdIssue(input.id, 'id')];
  if (!isPreflightFindingKind(input.kind)) {
    issues.push(validationIssue('invalid-type', 'kind', 'unknown finding kind'));
  }
  if (!(FINDING_SEVERITIES as readonly string[]).includes(input.severity)) {
    issues.push(validationIssue('invalid-type', 'severity', 'unknown severity'));
  }
  if (input.severity === 'blocking' && !BLOCKABLE_KINDS.includes(input.kind)) {
    issues.push(
      validationIssue(
        'invalid-type',
        'severity',
        `'${input.kind}' is a planning fact and may not be blocking`,
      ),
    );
  }
  if (input.statement.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'statement', 'statement required'));
  }
  if (input.recommendation.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'recommendation', 'recommendation required'));
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    issues.push(validationIssue('out-of-range', 'confidence', 'confidence must be 0..1'));
  }
  if (!isProvenance(input.provenance) || knowledgeCategoryOf(input.provenance) === 'reserved') {
    issues.push(validationIssue('unknown-provenance', 'provenance', 'invalid provenance'));
  }
  if (input.analyzer.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'analyzer', 'producing analyzer required'));
  }
  /**
   * A blocking finding with no evidence is exactly the failure mode this system exists to avoid:
   * it stops work on an assertion nobody can check.
   */
  if (input.severity === 'blocking' && input.evidenceIds.length === 0) {
    issues.push(
      validationIssue('missing-evidence', 'evidenceIds', 'a blocking finding requires evidence'),
    );
  }
  return issues;
};

export const createPreflightFinding = (
  input: PreflightFinding,
): Result<PreflightFinding, ValidationError> => {
  const issues = collectIssues(input);
  return issues.length > 0 ? err(validationError(issues)) : ok(deepFreeze({ ...input }));
};

export const isBlocking = (finding: PreflightFinding): boolean => finding.severity === 'blocking';
