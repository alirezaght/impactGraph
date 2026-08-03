import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createClarificationRecord } from '../specification/clarification.js';

import {
  isRawObject,
  readBoolean,
  readNumber,
  readOptionalString,
  readString,
  readStringArray,
} from './parse-helpers.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ClarificationAuthor, ClarificationRecord } from '../specification/clarification.js';

export const CLARIFICATION_SCHEMA_VERSION = 1;

export interface ClarificationJson extends ClarificationRecord {
  readonly schemaVersion: number;
}

export const serializeClarification = (record: ClarificationRecord): ClarificationJson => ({
  schemaVersion: CLARIFICATION_SCHEMA_VERSION,
  ...record,
});

export const parseClarification = (
  value: unknown,
): Result<ClarificationRecord, ValidationError> => {
  if (!isRawObject(value)) {
    return err(validationError([validationIssue('invalid-type', 'record', 'not an object')]));
  }
  if (value['schemaVersion'] !== CLARIFICATION_SCHEMA_VERSION) {
    return err(
      validationError([
        validationIssue('invalid-type', 'schemaVersion', 'unknown clarification schema version'),
      ]),
    );
  }
  const issues: ValidationIssue[] = [];
  const snapshot = readOptionalString(
    value,
    'repositorySnapshotId',
    'repositorySnapshotId',
    issues,
  );
  const parsed: ClarificationRecord = {
    id: readString(value, 'id', 'id', issues),
    questionKey: readString(value, 'questionKey', 'questionKey', issues),
    question: readString(value, 'question', 'question', issues),
    decision: readString(value, 'decision', 'decision', issues),
    reason: readString(value, 'reason', 'reason', issues),
    specificationId: readString(value, 'specificationId', 'specificationId', issues),
    specificationVersion: readNumber(value, 'specificationVersion', 'specificationVersion', issues),
    ...(snapshot === undefined ? {} : { repositorySnapshotId: snapshot }),
    relatedRequirementIds: readStringArray(
      value,
      'relatedRequirementIds',
      'relatedRequirementIds',
      issues,
    ),
    relatedNodeIds: readStringArray(value, 'relatedNodeIds', 'relatedNodeIds', issues),
    relatedContexts: readStringArray(value, 'relatedContexts', 'relatedContexts', issues),
    decidedAt: readString(value, 'decidedAt', 'decidedAt', issues),
    author: readString(value, 'author', 'author', issues) as ClarificationAuthor,
    confidence: readNumber(value, 'confidence', 'confidence', issues),
    manuallyConfirmed: readBoolean(value, 'manuallyConfirmed', 'manuallyConfirmed', issues),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createClarificationRecord(parsed);
};
