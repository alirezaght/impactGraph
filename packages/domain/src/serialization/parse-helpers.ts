import { validationIssue } from '../errors/validation.js';

import type { ValidationIssue } from '../errors/validation.js';

export type RawObject = Record<string, unknown>;

export const isRawObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typeIssue = (path: string, expected: string): ValidationIssue =>
  validationIssue('invalid-type', path, `${path} must be ${expected}`);

export const readString = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string => {
  const value = obj[key];
  if (typeof value === 'string') {
    return value;
  }
  issues.push(typeIssue(path, 'a string'));
  return '';
};

export const readOptionalString = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined => {
  const value = obj[key];
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  issues.push(typeIssue(path, 'a string when present'));
  return undefined;
};

export const readOptionalNumber = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number | undefined => {
  const value = obj[key];
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  issues.push(typeIssue(path, 'a number when present'));
  return undefined;
};

export const readNumber = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number => {
  const value = obj[key];
  if (typeof value === 'number') {
    return value;
  }
  issues.push(typeIssue(path, 'a number'));
  return Number.NaN;
};

export const readBoolean = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean => {
  const value = obj[key];
  if (typeof value === 'boolean') {
    return value;
  }
  issues.push(typeIssue(path, 'a boolean'));
  return false;
};

export const readObject = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): RawObject => {
  const value = obj[key];
  if (isRawObject(value)) {
    return value;
  }
  issues.push(typeIssue(path, 'an object'));
  return {};
};

export const readOptionalObject = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): RawObject | undefined => {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (isRawObject(value)) {
    return value;
  }
  issues.push(typeIssue(path, 'an object when present'));
  return undefined;
};

export const readArray = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): unknown[] => {
  const value = obj[key];
  if (Array.isArray(value)) {
    return value;
  }
  issues.push(typeIssue(path, 'an array'));
  return [];
};

export const readStringArray = (
  obj: RawObject,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string[] =>
  readArray(obj, key, path, issues).map((entry, index) => {
    if (typeof entry === 'string') {
      return entry;
    }
    issues.push(typeIssue(`${path}[${index}]`, 'a string'));
    return '';
  });

export const checkSchemaVersion = (
  obj: RawObject,
  expected: number,
  issues: ValidationIssue[],
): void => {
  if (obj['schemaVersion'] !== expected) {
    issues.push(
      validationIssue(
        'unsupported-schema-version',
        'schemaVersion',
        `expected schemaVersion ${String(expected)}`,
      ),
    );
  }
};
