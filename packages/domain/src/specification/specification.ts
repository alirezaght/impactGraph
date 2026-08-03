import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';

import { requirementIssues } from './requirement.js';

import type { Requirement } from './requirement.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';

// PRD §11 — implemented as written. rawText is preserved verbatim at every version; generated
// summaries are derived views and never replace it (main skill §1).

export const SPECIFICATION_SOURCE_TYPES = [
  'pasted',
  'selection',
  'markdown',
  'agent',
  'external',
] as const;
export type SpecificationSourceType = (typeof SPECIFICATION_SOURCE_TYPES)[number];

export const OPEN_QUESTION_SEVERITIES = ['blocking', 'important', 'minor'] as const;
export type OpenQuestionSeverity = (typeof OPEN_QUESTION_SEVERITIES)[number];

export const OPEN_QUESTION_STATUSES = ['open', 'answered', 'dismissed'] as const;
export type OpenQuestionStatus = (typeof OPEN_QUESTION_STATUSES)[number];

/** PRD §11.2. */
export interface OpenQuestion {
  readonly id: string;
  readonly question: string;
  readonly reason: string;
  readonly affectedRequirementIds: readonly string[];
  readonly severity: OpenQuestionSeverity;
  readonly status: OpenQuestionStatus;
  readonly answer?: string;
}

export interface Actor {
  readonly id: string;
  readonly name: string;
}

export interface Constraint {
  readonly id: string;
  readonly statement: string;
}

/** A product-level decision recorded on the spec (PRD §11, §C9 grows this later). */
export interface ArchitecturalDecision {
  readonly id: string;
  readonly decision: string;
  readonly reason: string;
  /** Set when the decision records a user selecting a §C8/§26 AI-assisted option (§40.3):
   *  the selection is human-confirmed; the referenced option stays AI-labeled on the analysis. */
  readonly optionId?: string;
  readonly decidedAt?: string;
}

export interface Specification {
  readonly id: string;
  readonly title: string;
  readonly sourceType: SpecificationSourceType;
  readonly sourceReference?: string;
  readonly rawText: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requirements: readonly Requirement[];
  readonly actors: readonly Actor[];
  readonly constraints: readonly Constraint[];
  readonly openQuestions: readonly OpenQuestion[];
  readonly decisions: readonly ArchitecturalDecision[];
}

const questionIssues = (
  question: OpenQuestion,
  requirementIds: ReadonlySet<string>,
  path: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [...blankIdIssue(question.id, `${path}.id`)];
  if (question.question.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.question`, 'question must not be blank'));
  }
  if (!(OPEN_QUESTION_SEVERITIES as readonly string[]).includes(question.severity)) {
    issues.push(validationIssue('invalid-type', `${path}.severity`, 'unknown severity'));
  }
  if (!(OPEN_QUESTION_STATUSES as readonly string[]).includes(question.status)) {
    issues.push(validationIssue('invalid-type', `${path}.status`, 'unknown status'));
  }
  if (question.status === 'answered' && (question.answer ?? '').trim().length === 0) {
    issues.push(
      validationIssue('blank-field', `${path}.answer`, 'answered questions must carry an answer'),
    );
  }
  for (const requirementId of question.affectedRequirementIds) {
    if (!requirementIds.has(requirementId)) {
      issues.push(
        validationIssue(
          'unknown-node-reference',
          `${path}.affectedRequirementIds`,
          `question references nonexistent requirement '${requirementId}'`,
        ),
      );
    }
  }
  return issues;
};

const duplicateIdIssues = (ids: readonly string[], path: string): ValidationIssue[] => {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(validationIssue('duplicate-id', path, `duplicate id '${id}'`));
    }
    seen.add(id);
  }
  return issues;
};

const specificationIssues = (input: Specification): ValidationIssue[] => {
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...duplicateIdIssues(
      input.requirements.map((requirement) => requirement.id),
      'requirements',
    ),
    ...duplicateIdIssues(
      input.openQuestions.map((question) => question.id),
      'openQuestions',
    ),
  ];
  if (input.title.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'title', 'title must not be blank'));
  }
  if (!(SPECIFICATION_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
    issues.push(validationIssue('invalid-type', 'sourceType', 'unknown sourceType'));
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    issues.push(validationIssue('out-of-range', 'version', 'version must be a positive integer'));
  }
  if (!isValidTimestamp(input.createdAt) || !isValidTimestamp(input.updatedAt)) {
    issues.push(validationIssue('invalid-timestamp', 'createdAt', 'timestamps must be ISO-8601'));
  }
  input.requirements.forEach((requirement, index) => {
    issues.push(...requirementIssues(requirement, `requirements[${index}]`));
  });
  input.openQuestions.forEach((question, index) => {
    issues.push(...questionIssues(question, requirementIds, `openQuestions[${index}]`));
  });
  return issues;
};

export type CreateSpecificationInput = Specification;

export const createSpecification = (
  input: CreateSpecificationInput,
): Result<Specification, ValidationError> => {
  const issues = specificationIssues(input);
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(deepFreeze({ ...input }));
};

export interface NextVersionChanges {
  readonly rawText?: string;
  readonly title?: string;
  readonly requirements?: readonly Requirement[];
  readonly actors?: readonly Actor[];
  readonly constraints?: readonly Constraint[];
  readonly openQuestions?: readonly OpenQuestion[];
  readonly decisions?: readonly ArchitecturalDecision[];
}

/**
 * Append-only versioning (PRD §40.2): saving produces version N+1 with the same id and
 * original createdAt; the previous version object is untouched and stays valid history.
 */
export const createNextSpecificationVersion = (
  previous: Specification,
  changes: NextVersionChanges,
  updatedAt: string,
): Result<Specification, ValidationError> =>
  createSpecification({
    ...previous,
    ...changes,
    version: previous.version + 1,
    updatedAt,
  });
