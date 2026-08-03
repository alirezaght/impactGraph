import { gitError } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';

import { parseNameStatus, parseUntracked } from './diff-parsing.js';
import { runGit } from './run-git.js';

import type { GitCommandResult } from './run-git.js';
import type {
  GitDiffResult,
  GitError,
  GitPort,
  GitRepositoryStatus,
} from '@impactgraph/application';
import type { RepositoryHead, Result } from '@impactgraph/domain';

const classifyFailure = (result: GitCommandResult): GitError => {
  if (result.spawnErrorCode === 'ENOENT') {
    return gitError('git-unavailable', 'git executable not found on PATH');
  }
  if (result.stderr.toLowerCase().includes('not a git repository')) {
    return gitError('not-a-repository', 'directory is not inside a git repository');
  }
  return gitError('command-failed', result.stderr.trim() || 'git command failed');
};

const readHead = async (directory: string): Promise<Result<RepositoryHead, GitError>> => {
  const commit = await runGit(directory, ['rev-parse', '--verify', 'HEAD']);
  if (commit.exitCode !== 0) {
    if (commit.spawnErrorCode === undefined && commit.stderr.includes('Needed a single revision')) {
      return err(gitError('no-commits', 'repository has no commits yet'));
    }
    const failure = classifyFailure(commit);
    return err(
      failure.code === 'command-failed'
        ? gitError('no-commits', 'HEAD cannot be resolved — repository has no commits yet')
        : failure,
    );
  }
  const commitSha = commit.stdout.trim();
  const branch = await runGit(directory, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (branch.exitCode === 0 && branch.stdout.trim().length > 0) {
    return ok({ kind: 'branch', branch: branch.stdout.trim(), commitSha });
  }
  return ok({ kind: 'detached', commitSha });
};

class GitCliAdapter implements GitPort {
  /** HEAD vs working tree with rename detection, plus untracked files (PRD §23.2, §24). */
  public async readWorkingTreeDiff(directory: string): Promise<Result<GitDiffResult, GitError>> {
    const diff = await runGit(directory, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      'HEAD',
      '--',
    ]);
    if (diff.exitCode !== 0) {
      return err(classifyFailure(diff));
    }
    const untracked = await runGit(directory, ['ls-files', '--others', '--exclude-standard', '-z']);
    if (untracked.exitCode !== 0) {
      return err(classifyFailure(untracked));
    }
    return ok({
      changes: [...parseNameStatus(diff.stdout), ...parseUntracked(untracked.stdout)],
    });
  }

  /** A commit vs its parent (default HEAD), with rename detection. */
  public async readCommitDiff(
    directory: string,
    ref = 'HEAD',
  ): Promise<Result<GitDiffResult, GitError>> {
    const diff = await runGit(directory, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-z',
      '-r',
      '--find-renames',
      '--root',
      ref,
      '--',
    ]);
    if (diff.exitCode !== 0) {
      return err(classifyFailure(diff));
    }
    return ok({ changes: parseNameStatus(diff.stdout) });
  }

  /** §C7 evidence base: which files changed together, over recent history. */
  public async readRecentCommitFiles(
    directory: string,
    maxCommits: number,
  ): Promise<Result<readonly (readonly string[])[], GitError>> {
    const log = await runGit(directory, [
      'log',
      `-n`,
      String(maxCommits),
      '--no-merges',
      '--name-only',
      '-z',
      '--pretty=format:%x01',
      '--',
    ]);
    if (log.exitCode !== 0) {
      return err(classifyFailure(log));
    }
    // \x01 marks each commit header; filenames are NUL-separated (hostile-name safe).
    const commits = log.stdout
      .split('\u0001')
      .map((block) =>
        block
          .split('\u0000')
          .map((entry) => entry.replace(/^\n+/, '').trim())
          .filter((entry) => entry.length > 0),
      )
      .filter((files) => files.length > 0);
    return ok(commits);
  }

  public async readFileAtRevision(
    directory: string,
    revision: string,
    filePath: string,
  ): Promise<Result<string | undefined, GitError>> {
    // `./` forces relative-path syntax, so a path starting with '-' is read as a path and not
    // parsed as part of the revision (`HEAD~1:-flag.ts` is otherwise a "bad revision"). A
    // trailing `--` must NOT be added here: it turns the whole `rev:./path` form invalid.
    const shown = await runGit(directory, ['show', `${revision}:./${filePath}`]);
    if (shown.exitCode === 0) {
      return ok(shown.stdout);
    }
    const stderr = shown.stderr.toLowerCase();
    // "path does not exist in <rev>" / "exists on disk, but not in" → the file is new there.
    if (stderr.includes('does not exist in') || stderr.includes('but not in')) {
      return ok(undefined);
    }
    return err(classifyFailure(shown));
  }

  public async readRepositoryStatus(
    directory: string,
  ): Promise<Result<GitRepositoryStatus, GitError>> {
    const toplevel = await runGit(directory, ['rev-parse', '--show-toplevel']);
    if (toplevel.exitCode !== 0) {
      return err(classifyFailure(toplevel));
    }
    const head = await readHead(directory);
    if (!head.ok) {
      return head;
    }
    // -z: NUL-separated, immune to hostile filenames (newlines, leading dashes).
    const status = await runGit(directory, ['status', '--porcelain', '-z']);
    if (status.exitCode !== 0) {
      return err(classifyFailure(status));
    }
    return ok({
      repositoryIdentity: toplevel.stdout.trim(),
      head: head.value,
      dirtyWorkingTree: status.stdout.length > 0,
    });
  }
}

export const createGitCliAdapter = (): GitPort => new GitCliAdapter();
