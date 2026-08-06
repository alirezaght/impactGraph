import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { performIndexRun } from './indexing.js';
import { readRepositoryRoster } from './registered-repositories.js';
import {
  collectWorkspaceRepositoryContext,
  ensureRegisteredRepositoriesIndexed,
} from './repository-coverage.js';
import { discoverCandidateRepositories } from './repository-discovery.js';
import { initializeWorkspace } from './workspace.js';

// A workspace root (git repo) with a registered subrepository, a registered-but-absent
// member, and an unregistered candidate — the §Z multi-repository roster made real.

let root = '';

const write = (relativePath: string, content: string): void => {
  const absolute = join(root, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
};

const git = (...args: string[]): void => {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'impactgraph-repo-coverage-'));
  write('package.json', JSON.stringify({ name: 'workspace-root' }));
  write('src/root.ts', 'export const root = 1;\n');
  write('svc-a/package.json', JSON.stringify({ name: 'svc-a' }));
  write('svc-a/src/a.ts', 'export const a = 1;\n');
  write('cand/file.ts', 'export const c = 1;\n');
  mkdirSync(join(root, 'cand', '.git'), { recursive: true });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '--all');
  git('commit', '-m', 'initial');
  initializeWorkspace(root);
  writeFileSync(
    join(root, '.impactgraph', 'config.yml'),
    'schemaVersion: 1\nrepositories:\n  - name: svc-a\n    path: svc-a\n  - name: ghost\n    path: ghost\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('roster-driven indexing and derived repository coverage', () => {
  it('indexes every registered, present repository into one graph and reports per-repo state', async () => {
    const run = await performIndexRun(root);
    expect(run.ok).toBe(true);
    if (!run.ok) {
      return;
    }
    const byName = Object.fromEntries(run.value.repositories.map((state) => [state.name, state]));
    expect(byName['(workspace root)']?.indexed).toBe(true);
    expect(byName['svc-a']?.indexed).toBe(true);
    expect(byName['svc-a']?.fileCount).toBeGreaterThan(0);
    expect(byName['ghost']?.indexed).toBe(false);
    expect(byName['ghost']?.reason).toContain('does not exist');
  });

  it('derives the same per-repo state from the stored snapshot', async () => {
    const context = await collectWorkspaceRepositoryContext(root);
    expect(context.ok).toBe(true);
    if (!context.ok) {
      return;
    }
    const byName = Object.fromEntries(
      context.value.repositories.map((state) => [state.name, state]),
    );
    expect(byName['svc-a']?.indexed).toBe(true);
    expect(byName['ghost']?.indexed).toBe(false);
    expect(context.value.limitations.join(' ')).toContain('ghost');
  });

  it('discovers the unregistered git directory as a candidate, never a member', () => {
    const roster = readRepositoryRoster(root);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    const candidates = discoverCandidateRepositories(root, roster.value);
    expect(candidates.map((candidate) => candidate.name)).toEqual(['cand']);
    expect(candidates[0]?.hint).toContain('not registered');
  });

  it('auto-indexes a repository registered after the last run — and only then', async () => {
    const before = await ensureRegisteredRepositoriesIndexed(root);
    expect(before.ok && !before.value.reindexed).toBe(true);

    write('svc-b/package.json', JSON.stringify({ name: 'svc-b' }));
    write('svc-b/src/b.ts', 'export const b = 1;\n');
    appendFileSync(
      join(root, '.impactgraph', 'config.yml'),
      '  - name: svc-b\n    path: svc-b\n',
    );

    const ensured = await ensureRegisteredRepositoriesIndexed(root);
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) {
      return;
    }
    expect(ensured.value.reindexed).toBe(true);

    const context = await collectWorkspaceRepositoryContext(root);
    expect(context.ok).toBe(true);
    if (!context.ok) {
      return;
    }
    const svcB = context.value.repositories.find((state) => state.name === 'svc-b');
    expect(svcB?.indexed).toBe(true);

    const again = await ensureRegisteredRepositoriesIndexed(root);
    expect(again.ok && !again.value.reindexed).toBe(true);
  });
});
