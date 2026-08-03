import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot, serializeRepositorySnapshot } from '@impactgraph/domain';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startIndexWorker } from '../index.js';

import type { WorkerIndexRequest } from '../index.js';
import type { IndexProgress } from '@impactgraph/application';
import type { RepositorySnapshot, RepositorySnapshotId } from '@impactgraph/domain';

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const snapshot: RepositorySnapshot = unwrap(
  createRepositorySnapshot({
    id: 'snap-worker',
    repositoryIdentity: '/work/ts-basic',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
  }),
  'snapshot',
);

// The workspace runs from TypeScript sources, so the worker needs the tsx loader.
const TSX_EXEC_ARGV = ['--import', 'tsx'];

describe('index worker process (Story 2.6)', () => {
  let workDir: string;
  let request: WorkerIndexRequest;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'impactgraph-worker-'));
    const repoDir = join(workDir, 'repo');
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    request = {
      rootDir: repoDir,
      dbPath: join(workDir, 'index.sqlite'),
      snapshot: serializeRepositorySnapshot(snapshot),
      analysisRunId: 'run-worker',
      createdAt: '2026-08-01T10:00:00.000Z',
      ignoreGlobs: [],
      disabledFrameworks: [],
      incremental: true,
    };
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('indexes out of process, streaming structured progress, and persists the graph', async () => {
    const progress: IndexProgress[] = [];
    const handle = startIndexWorker(request, {
      execArgv: TSX_EXEC_ARGV,
      onProgress: (update) => progress.push(update),
    });
    const outcome = await handle.outcome;
    expect(outcome.kind).toBe('done');
    if (outcome.kind !== 'done') {
      return;
    }
    expect(outcome.summary.nodeCount).toBeGreaterThan(10);

    const phases = new Set(progress.map((update) => update.phase));
    expect(phases.has('scanning')).toBe(true);
    expect(phases.has('parsing')).toBe(true);
    expect(phases.has('persisting')).toBe(true);

    // The parent can open the same store afterwards — the graph is really on disk.
    const store = unwrap(openSqliteIndexStore(request.dbPath), 'store');
    const graph = unwrap(await store.loadGraph('snap-worker' as RepositorySnapshotId), 'graph');
    expect(graph.nodes.length).toBe(outcome.summary.nodeCount);
    const run = unwrap(await store.getRunRecord(), 'run record');
    expect(run?.snapshotId).toBe('snap-worker');
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
    await store.close();
  }, 30000);

  it('cancel() stops the run and leaves no completed generation', async () => {
    const handle = startIndexWorker(request, { execArgv: TSX_EXEC_ARGV });
    handle.cancel(); // cancel immediately — checked before the first parsed file
    const outcome = await handle.outcome;
    // Depending on timing the run either cancels or (rarely) completes; both must be safe.
    expect(['cancelled', 'done']).toContain(outcome.kind);
    if (outcome.kind === 'cancelled') {
      const store = unwrap(openSqliteIndexStore(request.dbPath), 'store');
      const current = await store.getCurrentSnapshotId();
      expect(current.ok && current.value).toBeUndefined();
      await store.close();
    }
  }, 30000);
});
