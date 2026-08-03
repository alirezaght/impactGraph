import { validationIssue } from '../errors/validation.js';
import { blankIdIssue } from '../provenance/evidence.js';

import type { ValidationIssue } from '../errors/validation.js';

// PRD §11.1 — implemented as written.
export const REQUIREMENT_TYPES = [
  'functional',
  'business-rule',
  'exception',
  'state-transition',
  'data',
  'integration',
  'security',
  'performance',
  'operational',
  'observability',
  'testing',
  'documentation',
] as const;

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could'] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const REQUIREMENT_STATUSES = ['draft', 'confirmed', 'rejected'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** Character-offset range into the specification's rawText (PRD §11.1 sourceRange). */
export interface TextRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface Requirement {
  readonly id: string;
  readonly statement: string;
  readonly type: RequirementType;
  readonly concepts: readonly string[];
  readonly actors: readonly string[];
  readonly priority?: RequirementPriority;
  readonly sourceRange?: TextRange;
  readonly status: RequirementStatus;
}

/** Deterministic content-derived id: FNV-1a over normalized text, with a kind prefix. */
export const stableContentId = (prefix: string, text: string): string => {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
};

/**
 * Stable requirement identity: re-extracting an unchanged statement yields the same id, so
 * impacts and SATISFIES links survive re-extraction (specification skill).
 */
export const stableRequirementId = (statement: string): string => stableContentId('req', statement);

const rangeIssues = (range: TextRange | undefined, path: string): ValidationIssue[] => {
  if (range === undefined) {
    return [];
  }
  const valid =
    Number.isInteger(range.startOffset) &&
    Number.isInteger(range.endOffset) &&
    range.startOffset >= 0 &&
    range.endOffset >= range.startOffset;
  return valid
    ? []
    : [validationIssue('out-of-range', path, 'sourceRange offsets must be ordered and >= 0')];
};

export const requirementIssues = (requirement: Requirement, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(requirement.id, `${path}.id`),
    ...rangeIssues(requirement.sourceRange, `${path}.sourceRange`),
  ];
  if (requirement.statement.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.statement`, 'statement must not be blank'));
  }
  if (!(REQUIREMENT_TYPES as readonly string[]).includes(requirement.type)) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.type`,
        `unknown requirement type '${requirement.type}'`,
      ),
    );
  }
  if (!(REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status)) {
    issues.push(
      validationIssue('invalid-type', `${path}.status`, `unknown status '${requirement.status}'`),
    );
  }
  if (
    requirement.priority !== undefined &&
    !(REQUIREMENT_PRIORITIES as readonly string[]).includes(requirement.priority)
  ) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.priority`,
        `unknown priority '${requirement.priority}'`,
      ),
    );
  }
  return issues;
};
