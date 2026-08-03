import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';

import { stableContentId } from './requirement.js';
import { createNextSpecificationVersion } from './specification.js';

import type { Specification } from './specification.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';

// Story 15.5 — clarification ADRs (PRD §C9). These are the ANALYZED PROJECT's decisions —
// persistent repository knowledge (§C11), never model tuning, and never our own engineering
// ADRs in docs/adr/. Append-only: a changed decision is a new record.

export const CLARIFICATION_AUTHORS = ['user', 'agent'] as const;
export type ClarificationAuthor = (typeof CLARIFICATION_AUTHORS)[number];

export interface ClarificationRecord {
  readonly id: string;
  /** Stable key over the question text — dedupes re-asked questions across analyses (§C9). */
  readonly questionKey: string;
  readonly question: string;
  readonly decision: string;
  readonly reason: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly repositorySnapshotId?: string | undefined;
  readonly relatedRequirementIds: readonly string[];
  readonly relatedNodeIds: readonly string[];
  readonly relatedContexts: readonly string[];
  readonly decidedAt: string;
  readonly author: ClarificationAuthor;
  readonly confidence: number;
  readonly manuallyConfirmed: boolean;
}

export const clarificationQuestionKey = (question: string): string =>
  stableContentId('clarification', question);

export const createClarificationRecord = (
  input: ClarificationRecord,
): Result<ClarificationRecord, ValidationError> => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.specificationId, 'specificationId'),
  ];
  if (input.question.trim().length === 0 || input.decision.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'question', 'question and decision are required'));
  }
  if (input.questionKey !== clarificationQuestionKey(input.question)) {
    issues.push(
      validationIssue('invalid-type', 'questionKey', 'questionKey must derive from the question'),
    );
  }
  if (!(CLARIFICATION_AUTHORS as readonly string[]).includes(input.author)) {
    issues.push(validationIssue('invalid-type', 'author', 'unknown author'));
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    issues.push(validationIssue('out-of-range', 'confidence', 'confidence must be 0..1'));
  }
  if (!isValidTimestamp(input.decidedAt)) {
    issues.push(validationIssue('invalid-timestamp', 'decidedAt', 'must be ISO-8601'));
  }
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(deepFreeze({ ...input }));
};

/**
 * Answering a question is an append-only edit: version N+1 carries the question as
 * `answered` with its answer; version N is untouched (PRD §40.2).
 */
export const answerOpenQuestion = (
  specification: Specification,
  questionId: string,
  answer: string,
  updatedAt: string,
): Result<Specification, ValidationError> => {
  const target = specification.openQuestions.find((question) => question.id === questionId);
  if (target === undefined) {
    return err(
      validationError([
        validationIssue('invalid-type', 'questionId', `open question not found: ${questionId}`),
      ]),
    );
  }
  if (answer.trim().length === 0) {
    return err(validationError([validationIssue('blank-field', 'answer', 'answer required')]));
  }
  return createNextSpecificationVersion(
    specification,
    {
      openQuestions: specification.openQuestions.map((question) =>
        question.id === questionId ? { ...question, status: 'answered', answer } : question,
      ),
    },
    updatedAt,
  );
};

/**
 * §C9: recorded decisions stop future analyses from re-asking. Questions whose stable key
 * matches a prior clarification come back `answered`, carrying the recorded decision forward.
 * Runs on the freshly extracted (unsaved) version — the count reports what was suppressed.
 */
export const applyKnownClarifications = (
  specification: Specification,
  records: readonly ClarificationRecord[],
): { readonly specification: Specification; readonly suppressedQuestionIds: readonly string[] } => {
  const byKey = new Map(records.map((record) => [record.questionKey, record]));
  const suppressed: string[] = [];
  const openQuestions = specification.openQuestions.map((question) => {
    if (question.status !== 'open') {
      return question;
    }
    const known = byKey.get(clarificationQuestionKey(question.question));
    if (known === undefined) {
      return question;
    }
    suppressed.push(question.id);
    return { ...question, status: 'answered' as const, answer: known.decision };
  });
  if (suppressed.length === 0) {
    return { specification, suppressedQuestionIds: [] };
  }
  return {
    specification: deepFreeze({ ...specification, openQuestions }),
    suppressedQuestionIds: suppressed,
  };
};
