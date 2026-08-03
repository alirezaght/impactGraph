import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storageError } from '@impactgraph/application';
import { createRepositorySnapshot, err } from '@impactgraph/domain';
import { createAdapterRegistry, createTypeScriptAdapter } from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { IndexSummary } from './index.js';
import type { IndexStorePort } from '@impactgraph/application';
import type { RepositorySnapshot, RepositorySnapshotId } from '@impactgraph/domain';

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const makeSnapshot = (id: string): RepositorySnapshot =>
  unwrap(
    createRepositorySnapshot({
      id,
      repositoryIdentity: '/work/ts-basic',
      head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
      dirtyWorkingTree: true,
      indexVersion: 1,
      createdAt: '2026-07-31T10:00:00.000Z',
    }),
    `snapshot ${id}`,
  );

describe('incremental indexing (Story 2.2)', () => {
  let workDir: string;
  let repoDir: string;
  let store: IndexStorePort;

  const runIndex = async (
    snapshotId: string,
    targetStore: IndexStorePort = store,
  ): Promise<IndexSummary> => {
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    return unwrap(
      await indexRepository(
        {
          rootDir: repoDir,
          snapshot: makeSnapshot(snapshotId),
          analysisRunId: `run-${snapshotId}`,
          createdAt: '2026-07-31T10:00:00.000Z',
        },
        { store: targetStore, registry },
      ),
      `index ${snapshotId}`,
    );
  };

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'impactgraph-incr-'));
    repoDir = join(workDir, 'repo');
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    store = unwrap(openSqliteIndexStore(join(workDir, 'index.sqlite')), 'open store');
  });

  afterEach(async () => {
    await store.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('re-index without changes parses nothing and reuses every cached fragment', async () => {
    const first = await runIndex('snap-1');
    expect(first.changedFileCount).toBe(first.fileCount);
    expect(first.reusedFileCount).toBe(0);

    const second = await runIndex('snap-2');
    expect(second.changedFileCount).toBe(0);
    expect(second.reusedFileCount).toBe(second.fileCount);
    expect(second.nodeCount).toBe(first.nodeCount);
    expect(second.edgeCount).toBe(first.edgeCount);

    const current = unwrap(await store.getCurrentSnapshotId(), 'current');
    expect(current).toBe('snap-2');
    const graph = unwrap(await store.loadGraph('snap-2' as RepositorySnapshotId), 'graph');
    for (const node of graph.nodes) {
      expect(node.knowledge.repositorySnapshotId).toBe('snap-2');
    }
  });

  it('a modified file is the only file re-parsed, and its new facts appear', async () => {
    await runIndex('snap-1');
    appendFileSync(
      join(repoDir, 'src/lib/deal-repository.ts'),
      '\nexport function countDeals(): number {\n  return 0;\n}\n',
    );
    const summary = await runIndex('snap-2');
    expect(summary.changedFileCount).toBe(1);
    expect(summary.reusedFileCount).toBe(summary.fileCount - 1);

    const graph = unwrap(await store.loadGraph('snap-2' as RepositorySnapshotId), 'graph');
    expect(graph.nodes.some((n) => n.id === 'symbol:src/lib/deal-repository.ts#countDeals')).toBe(
      true,
    );
  });

  it('a deleted file leaves no stale fragments in the new generation — and the old one keeps it', async () => {
    await runIndex('snap-1');
    rmSync(join(repoDir, 'src/alias-user.ts'));
    const summary = await runIndex('snap-2');
    expect(summary.changedFileCount).toBe(0);

    const fresh = unwrap(await store.loadGraph('snap-2' as RepositorySnapshotId), 'fresh graph');
    expect(fresh.nodes.some((n) => n.id.includes('alias-user'))).toBe(false);
    expect(fresh.edges.some((e) => e.id.includes('alias-user'))).toBe(false);

    const previous = unwrap(await store.loadGraph('snap-1' as RepositorySnapshotId), 'old graph');
    expect(previous.nodes.some((n) => n.id === 'file:src/alias-user.ts')).toBe(true);
  });

  it('a renamed file re-parses only itself and its importer, and edges follow the new path', async () => {
    await runIndex('snap-1');
    renameSync(join(repoDir, 'src/lib/base-service.ts'), join(repoDir, 'src/lib/base.ts'));
    const serviceFile = join(repoDir, 'src/services/deal-service.ts');
    writeFileSync(
      serviceFile,
      readFileSync(serviceFile, 'utf8').replace('../lib/base-service', '../lib/base'),
    );
    const summary = await runIndex('snap-2');
    expect(summary.changedFileCount).toBe(2); // the renamed file + the updated importer

    const graph = unwrap(await store.loadGraph('snap-2' as RepositorySnapshotId), 'graph');
    const edgeIds = graph.edges.map((e) => e.id);
    expect(edgeIds).toContain('imports:src/services/deal-service.ts->src/lib/base.ts');
    expect(edgeIds).toContain(
      'extends:symbol:src/services/deal-service.ts#DealService->symbol:src/lib/base.ts#BaseService',
    );
    expect(graph.nodes.some((n) => n.id === 'file:src/lib/base-service.ts')).toBe(false);
  });

  it('a failed re-index never dethrones the previous valid index, and its work is resumable', async () => {
    await runIndex('snap-1');
    appendFileSync(join(repoDir, 'src/lib/deal-repository.ts'), '\nexport const extra = 1;\n');

    const failingStore: IndexStorePort = {
      applyIndexUpdate: () => Promise.resolve(err(storageError('io', 'simulated crash'))),
      loadGraph: (id) => store.loadGraph(id),
      getSnapshot: (id) => store.getSnapshot(id),
      listSnapshots: () => store.listSnapshots(),
      getEvidence: (ids) => store.getEvidence(ids),
      getFileHashes: (id) => store.getFileHashes(id),
      getCurrentSnapshotId: () => store.getCurrentSnapshotId(),
      cacheFragments: (entries) => store.cacheFragments(entries),
      getCachedFragments: (requests) => store.getCachedFragments(requests),
      saveRunRecord: (record) => store.saveRunRecord(record),
      getRunRecord: () => store.getRunRecord(),
      close: () => Promise.resolve(),
    };
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    const failed = await indexRepository(
      {
        rootDir: repoDir,
        snapshot: makeSnapshot('snap-2'),
        analysisRunId: 'run-crash',
        createdAt: '2026-07-31T10:00:00.000Z',
      },
      { store: failingStore, registry },
    );
    expect(failed.ok).toBe(false);

    // Previous generation untouched and still current (PRD §34).
    expect(unwrap(await store.getCurrentSnapshotId(), 'current')).toBe('snap-1');
    const previous = unwrap(await store.loadGraph('snap-1' as RepositorySnapshotId), 'previous');
    expect(previous.nodes.length).toBeGreaterThan(10);

    // Partial progress persisted: the retry reuses the fragment parsed during the failed run.
    const retry = await runIndex('snap-3');
    expect(retry.changedFileCount).toBe(0);
    expect(unwrap(await store.getCurrentSnapshotId(), 'current after retry')).toBe('snap-3');
  });

  it('incremental: false forces a full re-parse', async () => {
    await runIndex('snap-1');
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    const summary = unwrap(
      await indexRepository(
        {
          rootDir: repoDir,
          snapshot: makeSnapshot('snap-2'),
          analysisRunId: 'run-full',
          createdAt: '2026-07-31T10:00:00.000Z',
          incremental: false,
        },
        { store, registry },
      ),
      'full re-index',
    );
    expect(summary.reusedFileCount).toBe(0);
    expect(summary.changedFileCount).toBe(summary.fileCount);
  });
});
