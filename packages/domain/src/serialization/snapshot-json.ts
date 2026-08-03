import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createRepositorySnapshot } from '../repository/repository-snapshot.js';

import {
  checkSchemaVersion,
  isRawObject,
  readBoolean,
  readNumber,
  readObject,
  readOptionalString,
  readString,
} from './parse-helpers.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { RepositoryHeadInput, RepositorySnapshot } from '../repository/repository-snapshot.js';

export const REPOSITORY_SNAPSHOT_SCHEMA_VERSION = 1;

export interface RepositoryHeadJson {
  readonly kind: string;
  readonly branch?: string;
  readonly commitSha: string;
}

export interface RepositorySnapshotJson {
  readonly schemaVersion: number;
  readonly id: string;
  readonly repositoryIdentity: string;
  readonly head: RepositoryHeadJson;
  readonly dirtyWorkingTree: boolean;
  readonly indexVersion: number;
  readonly createdAt: string;
}

export const serializeRepositorySnapshot = (
  snapshot: RepositorySnapshot,
): RepositorySnapshotJson => ({
  schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  id: snapshot.id,
  repositoryIdentity: snapshot.repositoryIdentity,
  head: snapshot.head,
  dirtyWorkingTree: snapshot.dirtyWorkingTree,
  indexVersion: snapshot.indexVersion,
  createdAt: snapshot.createdAt,
});

const readHead = (obj: Record<string, unknown>, issues: ValidationIssue[]): RepositoryHeadInput => {
  const head = readObject(obj, 'head', 'head', issues);
  const base = {
    kind: readString(head, 'kind', 'head.kind', issues),
    commitSha: readString(head, 'commitSha', 'head.commitSha', issues),
  };
  const branch = readOptionalString(head, 'branch', 'head.branch', issues);
  return branch === undefined ? base : { ...base, branch };
};

export const parseRepositorySnapshot = (
  value: unknown,
): Result<RepositorySnapshot, ValidationError> => {
  if (!isRawObject(value)) {
    return err(
      validationError([validationIssue('invalid-type', '', 'snapshot JSON must be an object')]),
    );
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, REPOSITORY_SNAPSHOT_SCHEMA_VERSION, issues);
  const input = {
    id: readString(value, 'id', 'id', issues),
    repositoryIdentity: readString(value, 'repositoryIdentity', 'repositoryIdentity', issues),
    head: readHead(value, issues),
    dirtyWorkingTree: readBoolean(value, 'dirtyWorkingTree', 'dirtyWorkingTree', issues),
    indexVersion: readNumber(value, 'indexVersion', 'indexVersion', issues),
    createdAt: readString(value, 'createdAt', 'createdAt', issues),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createRepositorySnapshot(input);
};
