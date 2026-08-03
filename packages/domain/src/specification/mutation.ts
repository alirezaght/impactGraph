import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';

import { createNextSpecificationVersion } from './specification.js';

import type { Requirement } from './requirement.js';
import type { Specification } from './specification.js';
import type { Result } from '../errors/result.js';
import type { ValidationError } from '../errors/validation.js';

// Story 5.4 — specification mutation API (PRD §11.1, §40.2). Every mutation appends version
// N+1 via createNextSpecificationVersion; version N stays untouched history. Requirement ids
// are NEVER regenerated — not even when the statement is edited — so RequirementImpact links
// and SATISFIES edges keyed on the original stableRequirementId survive every edit. The edit
// itself is recorded by the version bump (diffSpecifications reports the changed statement).

const notFound = (path: string, id: string): Result<never, ValidationError> =>
  err(validationError([validationIssue('invalid-type', path, `${path} not found: ${id}`)]));

const withRequirement = (
  specification: Specification,
  requirementId: string,
  update: (requirement: Requirement) => Requirement,
  updatedAt: string,
): Result<Specification, ValidationError> => {
  const target = specification.requirements.find((entry) => entry.id === requirementId);
  if (target === undefined) {
    return notFound('requirementId', requirementId);
  }
  return createNextSpecificationVersion(
    specification,
    {
      requirements: specification.requirements.map((entry) =>
        entry.id === requirementId ? update(entry) : entry,
      ),
    },
    updatedAt,
  );
};

/** Human accepts an extracted requirement: status → `confirmed` at version N+1 (§11.1). */
export const confirmRequirement = (
  specification: Specification,
  requirementId: string,
  updatedAt: string,
): Result<Specification, ValidationError> =>
  withRequirement(
    specification,
    requirementId,
    (entry) => ({ ...entry, status: 'confirmed' }),
    updatedAt,
  );

/** Human rejects an extracted requirement: status → `rejected`, record preserved (§40.2). */
export const rejectRequirement = (
  specification: Specification,
  requirementId: string,
  updatedAt: string,
): Result<Specification, ValidationError> =>
  withRequirement(
    specification,
    requirementId,
    (entry) => ({ ...entry, status: 'rejected' }),
    updatedAt,
  );

/**
 * Edit a requirement's statement. The ORIGINAL id is kept — never re-derived from the new
 * text — so existing impacts stay linked. The sourceRange is kept too: it still marks where
 * in the (verbatim, unchanged) rawText the requirement originated. Status is not reset.
 */
export const editRequirementStatement = (
  specification: Specification,
  requirementId: string,
  statement: string,
  updatedAt: string,
): Result<Specification, ValidationError> => {
  if (statement.trim().length === 0) {
    return err(
      validationError([validationIssue('blank-field', 'statement', 'statement must not be blank')]),
    );
  }
  return withRequirement(
    specification,
    requirementId,
    (entry) => ({ ...entry, statement }),
    updatedAt,
  );
};

/** Dismiss an open question: status → `dismissed`, the question stays in history (§11.2). */
export const dismissOpenQuestion = (
  specification: Specification,
  questionId: string,
  updatedAt: string,
): Result<Specification, ValidationError> => {
  const target = specification.openQuestions.find((entry) => entry.id === questionId);
  if (target === undefined) {
    return notFound('questionId', questionId);
  }
  return createNextSpecificationVersion(
    specification,
    {
      openQuestions: specification.openQuestions.map((entry) =>
        entry.id === questionId ? { ...entry, status: 'dismissed' } : entry,
      ),
    },
    updatedAt,
  );
};
