import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { performIndexRun } from './indexing.js';
import { collectWorkspaceStatus, initializeWorkspace } from './workspace.js';

// Dogfooding item 9: status must state the tool's own operational state — index freshness,
// categorized warnings and ignored source — instead of leaving the staleness judgment and the
// meaning of a bare warning count to the caller.

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
  root = mkdtempSync(join(tmpdir(), 'impactgraph-status-health-'));
  write('package.json', JSON.stringify({ name: 'status-fixture' }));
  write('src/a.ts', 'export const a = 1;\n');
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '--all');
  git('commit', '-m', 'initial');
  initializeWorkspace(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('workspace status states its own operational health', () => {
  it('omits the health blocks while nothing is indexed', async () => {
    const status = await collectWorkspaceStatus(root);
    expect(status.ok).toBe(true);
    if (!status.ok) {
      return;
    }
    expect(status.value.indexed).toBe(false);
    expect(status.value.freshness).toBeUndefined();
    expect(status.value.indexWarnings).toBeUndefined();
    expect(status.value.ignoredCount).toBeUndefined();
  });

  it('reports freshness, categorized warnings and the ignored count once indexed', async () => {
    const run = await performIndexRun(root);
    expect(run.ok).toBe(true);
    const status = await collectWorkspaceStatus(root);
    if (!status.ok) {
      throw new Error('status failed');
    }
    const { freshness, indexWarnings, ignoredCount, lastRun, snapshot } = status.value;
    if (
      freshness === undefined ||
      indexWarnings === undefined ||
      ignoredCount === undefined ||
      lastRun === undefined
    ) {
      throw new Error('expected the health blocks on an indexed workspace');
    }
    expect(status.value.indexed).toBe(true);
    // Derived at read time: the state names WHY, never just a boolean the caller must interpret.
    expect(freshness.stale).toBe(freshness.state !== 'current');
    expect(freshness.indexedSnapshotId).toBe(snapshot?.id);
    // The categorized report and the run summary agree about the same fact (GAP 3): the report's
    // total is the run's true warning count plus the deliberately ignored files.
    expect(indexWarnings.totalCount).toBe(lastRun.warningCount + ignoredCount);
    // Nothing was truncated in a run this small, so the report claims no sampling.
    expect(indexWarnings.sampled).toBeUndefined();
  });

  it('reports staleness after the tree moves past the index', async () => {
    write('src/b.ts', 'export const b = 2;\n');
    git('add', '--all');
    git('commit', '-m', 'moved past the index');
    const status = await collectWorkspaceStatus(root);
    expect(status.ok).toBe(true);
    if (!status.ok) {
      return;
    }
    expect(status.value.freshness?.state).toBe('behind-head');
    expect(status.value.freshness?.stale).toBe(true);
    expect(status.value.freshness?.reasons.length).toBeGreaterThan(0);
  });
});
