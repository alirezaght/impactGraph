import type { RepositoryHead, Result } from '@impactgraph/domain';

export type GitErrorCode = 'not-a-repository' | 'no-commits' | 'git-unavailable' | 'command-failed';

export interface GitError {
  readonly name: 'GitError';
  readonly code: GitErrorCode;
  readonly message: string;
}

export const gitError = (code: GitErrorCode, message: string): GitError =>
  Object.freeze({ name: 'GitError' as const, code, message });

/** Deterministic repository facts read from git plumbing — no code execution (PRD §23.1). */
export interface GitRepositoryStatus {
  /** Stable repository identity: the resolved repository root path. */
  readonly repositoryIdentity: string;
  readonly head: RepositoryHead;
  readonly dirtyWorkingTree: boolean;
}

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedPath {
  readonly path: string;
  readonly changeType: ChangeType;
  /** Set for renames — the moved file is ONE change, never a Missing+Unexpected pair (§24). */
  readonly previousPath?: string;
}

export interface GitDiffResult {
  readonly changes: readonly ChangedPath[];
}

/** Port to git metadata (ADR-0007: implemented by the git CLI adapter, nowhere else). */
export interface GitPort {
  readRepositoryStatus(directory: string): Promise<Result<GitRepositoryStatus, GitError>>;
  /** HEAD vs working tree, including untracked files (PRD §23.2 Review Working Tree). */
  readWorkingTreeDiff(directory: string): Promise<Result<GitDiffResult, GitError>>;
  /** A commit vs its parent (PRD §23.2 Review Current Commit). */
  readCommitDiff(directory: string, ref?: string): Promise<Result<GitDiffResult, GitError>>;
  /**
   * Files touched per recent commit, newest first (§C7/§Z9 co-change mining). Merge commits
   * are skipped; at most `maxCommits` entries.
   */
  readRecentCommitFiles(
    directory: string,
    maxCommits: number,
  ): Promise<Result<readonly (readonly string[])[], GitError>>;
  /**
   * File content at a revision — the baseline half of symbol-level `analyzeDiff` (§24).
   * `undefined` means the path did not exist at that revision (an added file), which is a
   * fact, not an error. Binary content is returned as-is; callers classify it.
   */
  readFileAtRevision(
    directory: string,
    revision: string,
    filePath: string,
  ): Promise<Result<string | undefined, GitError>>;
}
