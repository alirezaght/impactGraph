import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createSpecification } from '../specification/specification.js';

import {
  checkSchemaVersion,
  isRawObject,
  readArray,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringArray,
} from './parse-helpers.js';

import type { RawObject } from './parse-helpers.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ExtractionQuality, ExtractionStrategy } from '../specification/extraction-quality.js';
import type {
  Requirement,
  RequirementPriority,
  RequirementType,
  TextRange,
} from '../specification/requirement.js';
import type { SpecNote, SpecNoteKind } from '../specification/spec-notes.js';
import type {
  Actor,
  ArchitecturalDecision,
  Constraint,
  OpenQuestion,
  OpenQuestionSeverity,
  OpenQuestionStatus,
  Specification,
  SpecificationSourceType,
} from '../specification/specification.js';

export const SPECIFICATION_SCHEMA_VERSION = 1;

export interface SpecificationJson extends Specification {
  readonly schemaVersion: number;
}

export const serializeSpecification = (specification: Specification): SpecificationJson => ({
  schemaVersion: SPECIFICATION_SCHEMA_VERSION,
  ...specification,
});

type Reader<T> = (raw: unknown, path: string, issues: ValidationIssue[]) => T;

const readEach = <T>(
  raws: readonly unknown[],
  path: string,
  issues: ValidationIssue[],
  reader: Reader<T>,
): T[] => raws.map((raw, index) => reader(raw, `${path}[${index}]`, issues));

const expectObject = (raw: unknown, path: string, issues: ValidationIssue[]): RawObject => {
  if (isRawObject(raw)) {
    return raw;
  }
  issues.push(validationIssue('invalid-type', path, `${path} must be an object`));
  return {};
};

const readRequirement: Reader<Requirement> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const priority = readOptionalString(obj, 'priority', `${path}.priority`, issues);
  const rangeRaw = obj['sourceRange'];
  let sourceRange: TextRange | undefined;
  if (rangeRaw !== undefined) {
    const range = expectObject(rangeRaw, `${path}.sourceRange`, issues);
    sourceRange = {
      startOffset: readNumber(range, 'startOffset', `${path}.sourceRange.startOffset`, issues),
      endOffset: readNumber(range, 'endOffset', `${path}.sourceRange.endOffset`, issues),
    };
  }
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    statement: readString(obj, 'statement', `${path}.statement`, issues),
    type: readString(obj, 'type', `${path}.type`, issues) as RequirementType,
    concepts: readStringArray(obj, 'concepts', `${path}.concepts`, issues),
    actors: readStringArray(obj, 'actors', `${path}.actors`, issues),
    ...(priority === undefined ? {} : { priority: priority as RequirementPriority }),
    ...(sourceRange === undefined ? {} : { sourceRange }),
    status: readString(obj, 'status', `${path}.status`, issues) as Requirement['status'],
    // Additive fields: absent on specifications stored before structure-aware extraction.
    ...optionalStrings(obj, path, issues, ['origin', 'label', 'heading']),
    ...optionalNumber(obj, 'extractionConfidence', path, issues),
  };
};

/** Reads one optional number field into a spread-ready object, skipping it when absent. */
const optionalNumber = (
  obj: RawObject,
  field: string,
  path: string,
  issues: ValidationIssue[],
): Record<string, number> => {
  const value = readOptionalNumber(obj, field, `${path}.${field}`, issues);
  return value === undefined ? {} : { [field]: value };
};

/** Reads a set of optional string fields into a spread-ready object, skipping the absent ones. */
const optionalStrings = (
  obj: RawObject,
  path: string,
  issues: ValidationIssue[],
  fields: readonly string[],
): Record<string, string> => {
  const read: Record<string, string> = {};
  for (const field of fields) {
    const value = readOptionalString(obj, field, `${path}.${field}`, issues);
    if (value !== undefined) {
      read[field] = value;
    }
  }
  return read;
};

const readNote: Reader<SpecNote> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const rangeRaw = obj['sourceRange'];
  let sourceRange: TextRange | undefined;
  if (rangeRaw !== undefined) {
    const range = expectObject(rangeRaw, `${path}.sourceRange`, issues);
    sourceRange = {
      startOffset: readNumber(range, 'startOffset', `${path}.sourceRange.startOffset`, issues),
      endOffset: readNumber(range, 'endOffset', `${path}.sourceRange.endOffset`, issues),
    };
  }
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    kind: readString(obj, 'kind', `${path}.kind`, issues) as SpecNoteKind,
    statement: readString(obj, 'statement', `${path}.statement`, issues),
    ...optionalStrings(obj, path, issues, ['heading']),
    ...(sourceRange === undefined ? {} : { sourceRange }),
  };
};

const readExtractionQuality = (
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): ExtractionQuality => {
  const obj = expectObject(raw, path, issues);
  return {
    strategy: readString(obj, 'strategy', `${path}.strategy`, issues) as ExtractionStrategy,
    structuredRequirementCount: readNumber(
      obj,
      'structuredRequirementCount',
      `${path}.structuredRequirementCount`,
      issues,
    ),
    proseRequirementCount: readNumber(
      obj,
      'proseRequirementCount',
      `${path}.proseRequirementCount`,
      issues,
    ),
    // Additive: absent on artifacts stored before graduated extraction — never defaulted to 0.
    ...optionalNumber(obj, 'uncertainStatementCount', path, issues),
    recognizedSections: readStringArray(
      obj,
      'recognizedSections',
      `${path}.recognizedSections`,
      issues,
    ),
    provisional: obj['provisional'] === true,
    warnings: readStringArray(obj, 'warnings', `${path}.warnings`, issues),
  };
};

const readQuestion: Reader<OpenQuestion> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const answer = readOptionalString(obj, 'answer', `${path}.answer`, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    question: readString(obj, 'question', `${path}.question`, issues),
    reason: readString(obj, 'reason', `${path}.reason`, issues),
    affectedRequirementIds: readStringArray(
      obj,
      'affectedRequirementIds',
      `${path}.affectedRequirementIds`,
      issues,
    ),
    severity: readString(obj, 'severity', `${path}.severity`, issues) as OpenQuestionSeverity,
    status: readString(obj, 'status', `${path}.status`, issues) as OpenQuestionStatus,
    ...(answer === undefined ? {} : { answer }),
  };
};

const readActor: Reader<Actor> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    name: readString(obj, 'name', `${path}.name`, issues),
  };
};

const readConstraint: Reader<Constraint> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    statement: readString(obj, 'statement', `${path}.statement`, issues),
  };
};

const readDecision: Reader<ArchitecturalDecision> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const optionId = readOptionalString(obj, 'optionId', `${path}.optionId`, issues);
  const decidedAt = readOptionalString(obj, 'decidedAt', `${path}.decidedAt`, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    decision: readString(obj, 'decision', `${path}.decision`, issues),
    reason: readString(obj, 'reason', `${path}.reason`, issues),
    ...(optionId === undefined ? {} : { optionId }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
  };
};

/**
 * Fields added by structure-aware extraction. Absent means the stored version predates them, which
 * is NOT the same claim as "the author wrote none" — so each field stays absent rather than becoming
 * an empty array that would read as a measured zero.
 */
const readAdditive = (
  value: RawObject,
  issues: ValidationIssue[],
): Pick<Specification, 'notes' | 'extractionQuality'> => ({
  ...(value['notes'] === undefined
    ? {}
    : { notes: readEach(readArray(value, 'notes', 'notes', issues), 'notes', issues, readNote) }),
  ...(value['extractionQuality'] === undefined
    ? {}
    : {
        extractionQuality: readExtractionQuality(
          value['extractionQuality'],
          'extractionQuality',
          issues,
        ),
      }),
});

export const parseSpecification = (value: unknown): Result<Specification, ValidationError> => {
  if (!isRawObject(value)) {
    return err(
      validationError([
        validationIssue('invalid-type', '', 'specification JSON must be an object'),
      ]),
    );
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, SPECIFICATION_SCHEMA_VERSION, issues);
  const sourceReference = readOptionalString(value, 'sourceReference', 'sourceReference', issues);
  const input: Specification = {
    id: readString(value, 'id', 'id', issues),
    title: readString(value, 'title', 'title', issues),
    sourceType: readString(value, 'sourceType', 'sourceType', issues) as SpecificationSourceType,
    ...(sourceReference === undefined ? {} : { sourceReference }),
    rawText: readString(value, 'rawText', 'rawText', issues),
    version: readNumber(value, 'version', 'version', issues),
    createdAt: readString(value, 'createdAt', 'createdAt', issues),
    updatedAt: readString(value, 'updatedAt', 'updatedAt', issues),
    requirements: readEach(
      readArray(value, 'requirements', 'requirements', issues),
      'requirements',
      issues,
      readRequirement,
    ),
    actors: readEach(readArray(value, 'actors', 'actors', issues), 'actors', issues, readActor),
    constraints: readEach(
      readArray(value, 'constraints', 'constraints', issues),
      'constraints',
      issues,
      readConstraint,
    ),
    openQuestions: readEach(
      readArray(value, 'openQuestions', 'openQuestions', issues),
      'openQuestions',
      issues,
      readQuestion,
    ),
    decisions: readEach(
      readArray(value, 'decisions', 'decisions', issues),
      'decisions',
      issues,
      readDecision,
    ),
    ...readAdditive(value, issues),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createSpecification(input);
};
