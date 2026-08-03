import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGitCliAdapter } from './index.js';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const initRepo = (dir: string): void => {
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial');
};

describe('GitCliAdapter (Story 1.3, ADR-0007)', () => {
  let dir: string;
  const adapter = createGitCliAdapter();

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'impactgraph-git-')));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads identity, branch, commit, and clean status from a committed repo', async () => {
    initRepo(dir);
    const result = await adapter.readRepositoryStatus(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repositoryIdentity).toBe(dir);
      expect(result.value.head).toEqual({
        kind: 'branch',
        branch: 'main',
        commitSha: git(dir, 'rev-parse', 'HEAD'),
      });
      expect(result.value.dirtyWorkingTree).toBe(false);
    }
  });

  it('flags a dirty working tree, including untracked files', async () => {
    initRepo(dir);
    writeFileSync(join(dir, 'untracked.txt'), 'new\n');
    const untracked = await adapter.readRepositoryStatus(dir);
    expect(untracked.ok && untracked.value.dirtyWorkingTree).toBe(true);

    rmSync(join(dir, 'untracked.txt'));
    writeFileSync(join(dir, 'a.txt'), 'modified\n');
    const modified = await adapter.readRepositoryStatus(dir);
    expect(modified.ok && modified.value.dirtyWorkingTree).toBe(true);
  });

  it('reports a detached HEAD', async () => {
    initRepo(dir);
    const sha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '--detach', sha);
    const result = await adapter.readRepositoryStatus(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.head).toEqual({ kind: 'detached', commitSha: sha });
    }
  });

  it('returns a typed error for a folder that is not a git repository', async () => {
    const result = await adapter.readRepositoryStatus(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-a-repository');
    }
  });

  it('returns a typed error for a repository with no commits yet', async () => {
    git(dir, 'init', '-b', 'main');
    const result = await adapter.readRepositoryStatus(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no-commits');
    }
  });

  it('working-tree diff reports modified, untracked, deleted, and renamed files (§23.2)', async () => {
    initRepo(dir);
    writeFileSync(join(dir, 'b.txt'), 'tracked\n');
    git(dir, 'add', 'b.txt');
    git(dir, 'commit', '-m', 'add b');

    writeFileSync(join(dir, 'a.txt'), 'modified\n');
    writeFileSync(join(dir, 'new.txt'), 'untracked\n');
    git(dir, 'mv', 'b.txt', 'b-renamed.txt');

    const diff = await adapter.readWorkingTreeDiff(dir);
    expect(diff.ok).toBe(true);
    if (!diff.ok) {
      return;
    }
    const byPath = new Map(diff.value.changes.map((change) => [change.path, change]));
    expect(byPath.get('a.txt')?.changeType).toBe('modified');
    expect(byPath.get('new.txt')?.changeType).toBe('added');
    // A rename is ONE change with the previous path — never a delete+add pair (§24).
    expect(byPath.get('b-renamed.txt')?.changeType).toBe('renamed');
    expect(byPath.get('b-renamed.txt')?.previousPath).toBe('b.txt');
    expect(byPath.has('b.txt')).toBe(false);
  });

  it('commit diff reports the changes of HEAD against its parent', async () => {
    initRepo(dir);
    writeFileSync(join(dir, 'feature.txt'), 'feature\n');
    git(dir, 'add', 'feature.txt');
    git(dir, 'commit', '-m', 'feature');

    const diff = await adapter.readCommitDiff(dir);
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.value.changes).toEqual([{ path: 'feature.txt', changeType: 'added' }]);
    }
  });

  it('reads files-per-commit for co-change mining, newest first (§C7)', async () => {
    initRepo(dir);
    writeFileSync(join(dir, 'schema.prisma'), 'model A {}\n');
    writeFileSync(join(dir, 'migration.sql'), 'ALTER;\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'schema + migration');
    writeFileSync(join(dir, 'other.txt'), 'x\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'unrelated');

    const commits = await adapter.readRecentCommitFiles(dir, 10);
    expect(commits.ok).toBe(true);
    if (!commits.ok) {
      return;
    }
    expect(commits.value[0]).toEqual(['other.txt']);
    expect([...(commits.value[1] ?? [])].sort()).toEqual(['migration.sql', 'schema.prisma']);
    expect(commits.value[2]).toEqual(['a.txt']);
  });

  it('reads file content at a revision; a path absent there is a fact, not an error (§24)', async () => {
    initRepo(dir);
    writeFileSync(join(dir, 'service.ts'), 'export const v = 1;\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'baseline');
    writeFileSync(join(dir, 'service.ts'), 'export const v = 2;\n');
    writeFileSync(join(dir, '-flagged.ts'), 'export const f = 1;\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'second');

    const baseline = await adapter.readFileAtRevision(dir, 'HEAD~1', 'service.ts');
    expect(baseline.ok && baseline.value).toBe('export const v = 1;\n');

    // added between the revisions → undefined, not a failure
    const added = await adapter.readFileAtRevision(dir, 'HEAD~1', '-flagged.ts');
    expect(added.ok && added.value).toBeUndefined();

    // a path that looks like a flag still resolves at the revision that has it
    const hostile = await adapter.readFileAtRevision(dir, 'HEAD', '-flagged.ts');
    expect(hostile.ok && hostile.value).toBe('export const f = 1;\n');

    const badRevision = await adapter.readFileAtRevision(dir, 'no-such-rev', 'service.ts');
    expect(badRevision.ok).toBe(false);
  });

  it('handles hostile filenames without breaking status parsing', async () => {
    initRepo(dir);
    writeFileSync(join(dir, '-looks-like-a-flag.txt'), 'x\n');
    writeFileSync(join(dir, 'name with spaces.txt'), 'x\n');
    const result = await adapter.readRepositoryStatus(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dirtyWorkingTree).toBe(true);
    }
  });
});
