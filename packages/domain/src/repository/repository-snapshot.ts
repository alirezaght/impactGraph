import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue, isValidTimestamp } from '../provenance/evidence.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { RepositorySnapshotId } from '../ids.js';

export interface BranchHead {
  readonly kind: 'branch';
  readonly branch: string;
  readonly commitSha: string;
}

export interface DetachedHead {
  readonly kind: 'detached';
  readonly commitSha: string;
}

export type RepositoryHead = BranchHead | DetachedHead;

/**
 * Immutable record of what was analyzed (PRD §23.1): repository identity, branch/commit,
 * dirty-tree flag, index version, timestamp. Every index run and analysis references exactly one.
 */
export interface RepositorySnapshot {
  readonly id: RepositorySnapshotId;
  readonly repositoryIdentity: string;
  readonly head: RepositoryHead;
  readonly dirtyWorkingTree: boolean;
  readonly indexVersion: number;
  readonly createdAt: string;
}

export interface RepositoryHeadInput {
  readonly kind: string;
  readonly branch?: string;
  readonly commitSha: string;
}

export interface CreateRepositorySnapshotInput {
  readonly id: string;
  readonly repositoryIdentity: string;
  readonly head: RepositoryHeadInput;
  readonly dirtyWorkingTree: boolean;
  readonly indexVersion: number;
  readonly createdAt: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{4,40}$/i;

const headIssues = (head: RepositoryHeadInput): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (head.kind !== 'branch' && head.kind !== 'detached') {
    issues.push(
      validationIssue('invalid-type', 'head.kind', `head kind must be branch or detached`),
    );
  }
  if (head.kind === 'branch' && (head.branch === undefined || head.branch.trim().length === 0)) {
    issues.push(validationIssue('blank-field', 'head.branch', 'branch name must not be blank'));
  }
  if (!COMMIT_SHA_PATTERN.test(head.commitSha)) {
    issues.push(
      validationIssue('invalid-commit', 'head.commitSha', 'commit SHA must be 4–40 hex chars'),
    );
  }
  return issues;
};

const snapshotIssues = (input: CreateRepositorySnapshotInput): ValidationIssue[] => {
  const issues: ValidationIssue[] = [...blankIdIssue(input.id, 'id'), ...headIssues(input.head)];
  if (input.repositoryIdentity.trim().length === 0) {
    issues.push(
      validationIssue('blank-field', 'repositoryIdentity', 'repositoryIdentity must not be blank'),
    );
  }
  if (!Number.isInteger(input.indexVersion) || input.indexVersion < 1) {
    issues.push(
      validationIssue('out-of-range', 'indexVersion', 'indexVersion must be a positive integer'),
    );
  }
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(
      validationIssue('invalid-timestamp', 'createdAt', 'createdAt must be an ISO-8601 timestamp'),
    );
  }
  return issues;
};

const buildHead = (head: RepositoryHeadInput): RepositoryHead =>
  head.kind === 'branch'
    ? { kind: 'branch', branch: head.branch ?? '', commitSha: head.commitSha }
    : { kind: 'detached', commitSha: head.commitSha };

export const createRepositorySnapshot = (
  input: CreateRepositorySnapshotInput,
): Result<RepositorySnapshot, ValidationError> => {
  const issues = snapshotIssues(input);
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(
    deepFreeze({
      id: input.id as RepositorySnapshotId,
      repositoryIdentity: input.repositoryIdentity,
      head: buildHead(input.head),
      dirtyWorkingTree: input.dirtyWorkingTree,
      indexVersion: input.indexVersion,
      createdAt: input.createdAt,
    }),
  );
};
