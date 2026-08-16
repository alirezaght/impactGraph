import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';
import { isProvenance, knowledgeCategoryOf } from '../provenance/provenance.js';

import {
  canBlock,
  isConstraintKind,
  isConstraintRelation,
  CONSTRAINT_EXTRACTIONS,
  CONSTRAINT_SEVERITIES,
} from './constraint-vocabulary.js';

import type {
  ConstraintExtraction,
  ConstraintKind,
  ConstraintRelation,
  ConstraintSeverity,
} from './constraint-vocabulary.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { FileSource } from '../provenance/evidence.js';
import type { Provenance } from '../provenance/provenance.js';

/**
 * A repository rule, indexed as a first-class entity.
 *
 * The motivating failure: a design introduced peer-service HTTP that a CI script forbade, and the
 * incompatibility was discoverable from the specification alone — but nothing in the system held
 * the rule, so nothing could compare the two. A constraint is that missing half.
 */

/** The set of code the constraint governs. Empty globs means "the whole indexed scope". */
export interface ConstraintScope {
  /** Path globs, relative to the repository root. */
  readonly pathGlobs: readonly string[];
  /** Architecture roles this constraint applies to, when the repository declares roles. */
  readonly roles?: readonly string[];
  /** Bounded contexts this constraint applies to. */
  readonly contexts?: readonly string[];
}

/**
 * What the constraint actually prohibits or demands, as typed fields.
 *
 * `subjectPattern` is the thing being restricted, read from the guard: an import specifier pattern,
 * a peer-service URL shape, a configuration key. `targetScope` is the counterpart scope when the
 * rule is about a relationship between two places rather than about one place alone.
 */
export interface ConstraintRule {
  readonly relation: ConstraintRelation;
  /** The pattern the guard matches on, verbatim from the guard where possible. */
  readonly subjectPattern?: string;
  /** The counterpart scope for relationship rules (forbidden-dependency, boundary-restriction). */
  readonly targetScope?: ConstraintScope;
  /** For required-config / required-runtime: the names that must be present. */
  readonly requiredNames?: readonly string[];
  /** Human-readable statement of the rule, for reports. Never the sole carrier of meaning. */
  readonly statement: string;
}

/** A named escape from the constraint, with its own provenance in the guard. */
export interface ConstraintExemption {
  readonly id: string;
  /** What is exempted: a path glob, a service name, an identifier. */
  readonly subject: string;
  /** Where in the guard the exemption is declared. */
  readonly source: FileSource;
  readonly reason?: string;
}

export interface RepositoryConstraint {
  readonly id: string;
  readonly name: string;
  readonly kind: ConstraintKind;
  readonly severity: ConstraintSeverity;
  readonly extraction: ConstraintExtraction;
  readonly scope: ConstraintScope;
  readonly rule: ConstraintRule;
  readonly exemptions: readonly ConstraintExemption[];
  /** The guard that declares this constraint. */
  readonly source: FileSource;
  readonly provenance: Provenance;
  readonly evidenceIds: readonly string[];
  readonly repositorySnapshotId: string;
  readonly createdAt: string;
  /**
   * Why the rule could not be read, on `opaque` constraints. Required in spirit there: an opaque
   * guard reported without a reason is indistinguishable from a bug in the extractor.
   */
  readonly notExtractedReason?: string;
}

const scopeIssues = (scope: ConstraintScope, path: string): ValidationIssue[] =>
  scope.pathGlobs.some((glob) => glob.trim().length === 0)
    ? [validationIssue('blank-field', `${path}.pathGlobs`, 'path globs must not be blank')]
    : [];

/**
 * The enforcement point for "only authoritative extractions may block".
 *
 * A constraint claiming `blocking` on an `ai-proposed` or `opaque` extraction is REJECTED rather
 * than quietly downgraded: a quiet downgrade hides the producer that fabricated it, and this
 * invariant is the whole promise a BLOCKED assessment makes to a reader.
 */
const authorityIssues = (input: RepositoryConstraint, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (input.severity === 'blocking' && !canBlock(input.extraction)) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}severity`,
        `'blocking' is not available on '${input.extraction}' extraction — only ${'recognized'} or ${'declared'} constraints may block`,
      ),
    );
  }
  // Prose guidance is validated here, not left to producers: nothing parsed an ADR's rule, so
  // nothing may present it with the weight of deterministic enforcement.
  if (input.kind === 'architecture-guidance' && input.severity !== 'advisory') {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}severity`,
        `'architecture-guidance' is prose — it is always 'advisory', never '${input.severity}'`,
      ),
    );
  }
  return issues;
};

const vocabularyIssues = (input: RepositoryConstraint): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isConstraintKind(input.kind)) {
    issues.push(validationIssue('invalid-type', 'kind', 'unknown constraint kind'));
  }
  if (!(CONSTRAINT_SEVERITIES as readonly string[]).includes(input.severity)) {
    issues.push(validationIssue('invalid-type', 'severity', 'unknown severity'));
  }
  if (!(CONSTRAINT_EXTRACTIONS as readonly string[]).includes(input.extraction)) {
    issues.push(validationIssue('invalid-type', 'extraction', 'unknown extraction'));
  }
  if (!isConstraintRelation(input.rule.relation)) {
    issues.push(validationIssue('invalid-type', 'rule.relation', 'unknown constraint relation'));
  }
  if (!isProvenance(input.provenance) || knowledgeCategoryOf(input.provenance) === 'reserved') {
    issues.push(validationIssue('unknown-provenance', 'provenance', 'invalid provenance'));
  }
  return issues;
};

const collectIssues = (input: RepositoryConstraint): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.repositorySnapshotId, 'repositorySnapshotId'),
    ...vocabularyIssues(input),
    ...scopeIssues(input.scope, 'scope'),
    ...authorityIssues(input, ''),
  ];
  if (input.name.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'name', 'name required'));
  }
  if (input.rule.statement.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'rule.statement', 'rule statement required'));
  }
  if (input.source.filePath.trim().length === 0) {
    issues.push(validationIssue('invalid-source', 'source.filePath', 'source file required'));
  }
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(validationIssue('invalid-timestamp', 'createdAt', 'must be ISO-8601'));
  }
  if (input.kind === 'opaque-check' && (input.notExtractedReason ?? '').trim().length === 0) {
    issues.push(
      validationIssue(
        'blank-field',
        'notExtractedReason',
        'an opaque constraint must say why its rule was not extracted',
      ),
    );
  }
  input.exemptions.forEach((exemption, index) => {
    if (exemption.subject.trim().length === 0) {
      issues.push(
        validationIssue(
          'blank-field',
          `exemptions[${index}].subject`,
          'exemption subject required',
        ),
      );
    }
  });
  return issues;
};

export const createRepositoryConstraint = (
  input: RepositoryConstraint,
): Result<RepositoryConstraint, ValidationError> => {
  const issues = collectIssues(input);
  return issues.length > 0 ? err(validationError(issues)) : ok(deepFreeze({ ...input }));
};

/** True when the subject is named by any exemption of the constraint. */
export const isExempt = (constraint: RepositoryConstraint, subject: string): boolean =>
  constraint.exemptions.some((exemption) => exemption.subject === subject);
