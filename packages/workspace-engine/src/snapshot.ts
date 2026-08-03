import { createRepositorySnapshot } from '@impactgraph/domain';
import { createGitCliAdapter } from '@impactgraph/git';

import { engineFailure } from './failure.js';

import type { EngineFailure } from './failure.js';
import type { GitErrorCode } from '@impactgraph/application';
import type { RepositorySnapshot } from '@impactgraph/domain';

export const GIT_FAILURES: Record<GitErrorCode, EngineFailure['category']> = {
  'not-a-repository': 'unsupportedProject',
  'git-unavailable': 'unsupportedProject',
  'no-commits': 'unsupportedProject',
  'command-failed': 'indexingFailure',
};

/**
 * Snapshot identity (PRD §23.1): stable for a clean tree at a commit — re-indexing the same
 * clean state reuses the same immutable snapshot; dirty trees get a unique generation id.
 */
export const captureSnapshot = async (
  rootDir: string,
  now: () => string,
): Promise<{ ok: true; snapshot: RepositorySnapshot } | { ok: false; failure: EngineFailure }> => {
  const git = createGitCliAdapter();
  const status = await git.readRepositoryStatus(rootDir);
  if (!status.ok) {
    return {
      ok: false,
      failure: engineFailure(GIT_FAILURES[status.error.code], status.error.message),
    };
  }
  const { head, dirtyWorkingTree, repositoryIdentity } = status.value;
  const id = dirtyWorkingTree
    ? `snap-${head.commitSha.slice(0, 12)}-dirty-${Date.now().toString(36)}`
    : `snap-${head.commitSha.slice(0, 12)}`;
  const snapshot = createRepositorySnapshot({
    id,
    repositoryIdentity,
    head,
    dirtyWorkingTree,
    indexVersion: 1,
    createdAt: now(),
  });
  if (!snapshot.ok) {
    return {
      ok: false,
      failure: engineFailure('internalError', 'captured repository state failed validation'),
    };
  }
  return { ok: true, snapshot: snapshot.value };
};

export const snapshotSummary = (
  snapshot: RepositorySnapshot,
): {
  id: string;
  branch?: string;
  commitSha: string;
  dirtyWorkingTree: boolean;
  createdAt: string;
} => ({
  id: snapshot.id,
  ...(snapshot.head.kind === 'branch' ? { branch: snapshot.head.branch } : {}),
  commitSha: snapshot.head.commitSha,
  dirtyWorkingTree: snapshot.dirtyWorkingTree,
  createdAt: snapshot.createdAt,
});
