import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createEvidenceRecord } from '../provenance/evidence.js';

import {
  checkSchemaVersion,
  isRawObject,
  readNumber,
  readObject,
  readOptionalObject,
  readOptionalString,
  readString,
} from './parse-helpers.js';

import type { RawObject } from './parse-helpers.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { EvidenceRecord, EvidenceSource, SourceRange } from '../provenance/evidence.js';

export const EVIDENCE_RECORD_SCHEMA_VERSION = 1;

export interface EvidenceRecordJson {
  readonly schemaVersion: number;
  readonly id: string;
  readonly kind: string;
  readonly source: EvidenceSource;
  readonly repositorySnapshotId: string;
  readonly createdAt: string;
}

// EvidenceRecord is plain, JSON-safe, frozen data — serialization only stamps the version.
export const serializeEvidenceRecord = (record: EvidenceRecord): EvidenceRecordJson => ({
  schemaVersion: EVIDENCE_RECORD_SCHEMA_VERSION,
  id: record.id,
  kind: record.kind,
  source: record.source,
  repositorySnapshotId: record.repositorySnapshotId,
  createdAt: record.createdAt,
});

const readRange = (
  obj: RawObject | undefined,
  path: string,
  issues: ValidationIssue[],
): SourceRange | undefined => {
  if (obj === undefined) {
    return undefined;
  }
  return {
    startLine: readNumber(obj, 'startLine', `${path}.startLine`, issues),
    startColumn: readNumber(obj, 'startColumn', `${path}.startColumn`, issues),
    endLine: readNumber(obj, 'endLine', `${path}.endLine`, issues),
    endColumn: readNumber(obj, 'endColumn', `${path}.endColumn`, issues),
  };
};

const readFileSource = (
  obj: RawObject,
  path: string,
  issues: ValidationIssue[],
): EvidenceSource => {
  const base = {
    kind: 'file' as const,
    filePath: readString(obj, 'filePath', `${path}.filePath`, issues),
  };
  const range = readRange(
    readOptionalObject(obj, 'range', `${path}.range`, issues),
    `${path}.range`,
    issues,
  );
  const symbolName = readOptionalString(obj, 'symbolName', `${path}.symbolName`, issues);
  const ranged = range === undefined ? base : { ...base, range };
  return symbolName === undefined ? ranged : { ...ranged, symbolName };
};

const readSource = (obj: RawObject, path: string, issues: ValidationIssue[]): EvidenceSource => {
  const kind = readString(obj, 'kind', `${path}.kind`, issues);
  if (kind === 'file') {
    return readFileSource(obj, path, issues);
  }
  if (kind === 'config') {
    return {
      kind: 'config',
      filePath: readString(obj, 'filePath', `${path}.filePath`, issues),
      configKey: readString(obj, 'configKey', `${path}.configKey`, issues),
    };
  }
  if (kind === 'git-commit') {
    return {
      kind: 'git-commit',
      commitSha: readString(obj, 'commitSha', `${path}.commitSha`, issues),
    };
  }
  issues.push(validationIssue('invalid-source', `${path}.kind`, `unknown source kind '${kind}'`));
  return { kind: 'git-commit', commitSha: '' };
};

export const parseEvidenceRecord = (value: unknown): Result<EvidenceRecord, ValidationError> => {
  if (!isRawObject(value)) {
    return err(
      validationError([validationIssue('invalid-type', '', 'evidence JSON must be an object')]),
    );
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, EVIDENCE_RECORD_SCHEMA_VERSION, issues);
  const input = {
    id: readString(value, 'id', 'id', issues),
    kind: readString(value, 'kind', 'kind', issues),
    source: readSource(readObject(value, 'source', 'source', issues), 'source', issues),
    repositorySnapshotId: readString(value, 'repositorySnapshotId', 'repositorySnapshotId', issues),
    createdAt: readString(value, 'createdAt', 'createdAt', issues),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createEvidenceRecord(input);
};
