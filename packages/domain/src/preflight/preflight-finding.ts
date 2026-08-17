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
  /**
   * The plan's SQL compares a column whose indexed declared type is type-sensitive
   * (uuid/date/numeric/boolean) against bound parameters (ADR-0020 §4). A risk worth a look,
   * never a proven violation — the ADR-0018 asymmetry — so it can never be blocking.
   */
  'type-sensitive-comparison',
] as const;

export type PreflightFindingKind = (typeof PREFLIGHT_FINDING_KINDS)[number];

export const isPreflightFindingKind = (value: unknown): value is PreflightFindingKind =>
  typeof value === 'string' && (PREFLIGHT_FINDING_KINDS as readonly string[]).includes(value);

export const FINDING_SEVERITIES = ['blocking', 'warning', 'informational'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * How well the finding is established — the axis that decides whether it may block.
 *
 * A false BLOCKED verdict is far more damaging than an uncertain warning: developers who watch the
 * gate stop a valid specification learn to override it, and every later legitimate block is worth
 * less. So "blocking" is not a severity a producer may simply assert; it is a claim that
 * ImpactGraph has evidence the plan CONTRADICTS the repository, not merely that it could not
 * confirm the plan is right. Those two are not equivalent and must never collapse.
 */
export const FINDING_VERIFICATIONS = ['verified-contradiction', 'unverified-assumption'] as const;
export type FindingVerification = (typeof FINDING_VERIFICATIONS)[number];

/**
 * WHOSE problem the finding is about — orthogonal to kind and severity.
 *
 * `plan-finding` — evidence about the proposed specification. Only these are red-team findings.
 * `analysis-caveat` — ImpactGraph's own model, index or resolver could not establish something.
 *   A limit on what can be said, never evidence that the plan is bad.
 * `background-condition` — a pre-existing property of the repository the plan neither caused nor
 *   specifically touches. Worth knowing, not a risk this change introduced.
 */
export const FINDING_ORIGINS = ['plan-finding', 'analysis-caveat', 'background-condition'] as const;
export type FindingOrigin = (typeof FINDING_ORIGINS)[number];

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
  /**
   * Additive field: how well established the finding is. Absent reads as `verified-contradiction`
   * ONLY for non-blocking findings, because producers that predate the axis could not block
   * without also passing the kind gate below; a blocking finding must state it outright.
   */
  readonly verification?: FindingVerification;
  /** Additive field: whose problem this is. Absent reads as `plan-finding`, the old meaning. */
  readonly origin?: FindingOrigin;
}

/** Absence reads as the old meaning: a statement about the plan. */
export const findingOriginOf = (finding: PreflightFinding): FindingOrigin =>
  finding.origin ?? 'plan-finding';

/** Absence reads as unverified — the weaker, safer claim. */
export const verificationOf = (finding: PreflightFinding): FindingVerification =>
  finding.verification ?? 'unverified-assumption';

/** True when this finding is evidence about the specification, rather than about our own reach. */
export const isPlanFinding = (finding: PreflightFinding): boolean =>
  findingOriginOf(finding) === 'plan-finding';

/** True when the finding points at something concrete a reader can open. */
const hasSubject = (input: PreflightFinding): boolean =>
  (input.subject.nodeIds?.length ?? 0) > 0 ||
  (input.subject.filePaths?.length ?? 0) > 0 ||
  input.subject.constraintId !== undefined ||
  input.subject.runtimePathId !== undefined ||
  input.subject.assumedSymbol !== undefined ||
  input.subject.proposedRelationship !== undefined;

/** The vocabulary half: kind, severity, and what a severity is allowed to be claimed for. */
const taxonomyIssues = (input: PreflightFinding): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
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
  return issues;
};

/** The additive axes carry closed vocabularies of their own. */
const axisVocabularyIssues = (input: PreflightFinding): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (
    input.verification !== undefined &&
    !(FINDING_VERIFICATIONS as readonly string[]).includes(input.verification)
  ) {
    issues.push(validationIssue('invalid-type', 'verification', 'unknown verification'));
  }
  if (
    input.origin !== undefined &&
    !(FINDING_ORIGINS as readonly string[]).includes(input.origin)
  ) {
    issues.push(validationIssue('invalid-type', 'origin', 'unknown origin'));
  }
  return issues;
};

/**
 * What a BLOCKING claim costs to make (ADR-0023): only a verified contradiction against the plan
 * may stop work. "We could not verify this" and "our own reach ran out" are investigations, not
 * verdicts, and a gate that confuses them teaches readers to override it.
 */
const blockingClaimIssues = (input: PreflightFinding): ValidationIssue[] => {
  if (input.severity !== 'blocking') {
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (input.verification !== 'verified-contradiction') {
    issues.push(
      validationIssue(
        'invalid-type',
        'severity',
        'a blocking finding must state verification: verified-contradiction',
      ),
    );
  }
  if (input.origin !== undefined && input.origin !== 'plan-finding') {
    issues.push(
      validationIssue('invalid-type', 'severity', `a ${input.origin} may not be blocking`),
    );
  }
  return issues;
};

/**
 * A claim about the plan must be attributable to SOMETHING a reader can open: the requirement it
 * is about, or the code it is about. Review-time findings legitimately name only the latter. A
 * caveat about our own reach may name neither — its subject is our resolution, not the plan.
 */
const attributionIssues = (input: PreflightFinding): ValidationIssue[] =>
  findingOriginOf(input) === 'plan-finding' &&
  input.requirementIds.length === 0 &&
  !hasSubject(input)
    ? [
        validationIssue(
          'blank-field',
          'requirementIds',
          'a plan finding must name its requirement or the code it concerns',
        ),
      ]
    : [];

/**
 * A blocking finding with no evidence is exactly the failure mode this system exists to avoid:
 * it stops work on an assertion nobody can check.
 */
const blockingEvidenceIssues = (input: PreflightFinding): ValidationIssue[] =>
  input.severity === 'blocking' && input.evidenceIds.length === 0
    ? [validationIssue('missing-evidence', 'evidenceIds', 'a blocking finding requires evidence')]
    : [];

const collectIssues = (input: PreflightFinding): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...taxonomyIssues(input),
    ...axisVocabularyIssues(input),
    ...blockingClaimIssues(input),
    ...blockingEvidenceIssues(input),
    ...attributionIssues(input),
  ];
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
  return issues;
};

export const createPreflightFinding = (
  input: PreflightFinding,
): Result<PreflightFinding, ValidationError> => {
  const issues = collectIssues(input);
  return issues.length > 0 ? err(validationError(issues)) : ok(deepFreeze({ ...input }));
};

/**
 * Blocking is a conjunction, not a flag: the severity, the evidence grade and the target must all
 * agree. Reading all three here means no producer can create a blocking verdict by accident.
 */
export const isBlocking = (finding: PreflightFinding): boolean =>
  finding.severity === 'blocking' &&
  verificationOf(finding) === 'verified-contradiction' &&
  isPlanFinding(finding);
