import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import { createAdapterRegistry, createTypeScriptAdapter } from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { IndexStorePort } from '@impactgraph/application';
import type { RepositorySnapshot } from '@impactgraph/domain';

// Peak memory must not scale with total repository size (PRD §33). The indexer used to read
// every scanned file into one array and hold it until persist, so a repository larger than the
// heap could not be indexed at all — it died in the hash loop. These sizes make retention
// unmistakable: 320 files x ~256 KB is ~84 MB of content, far above any plausible steady state.
//
// Measured after a forced collection, so this asserts on LIVE bytes. `heapUsed` alone counts
// garbage the parse loop has already abandoned (~38 MB of it here), which would drown the signal.

const FILE_COUNT = 320;
const FILE_BYTES = 256 * 1024;
const CONTENT_BYTES = FILE_COUNT * FILE_BYTES;
/** Live steady state measured at ~2.5 MB; the pre-fix run held the full CONTENT_BYTES. */
const LIVE_BUDGET_BYTES = 16 * 1024 * 1024;

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const snapshot: RepositorySnapshot = unwrap(
  createRepositorySnapshot({
    id: 'snap-memory',
    repositoryIdentity: '/fixtures/memory',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-07-31T10:00:00.000Z',
  }),
  'snapshot',
);

/** A file whose bulk is comment text: large on disk, cheap to parse into facts. */
const bulkyModule = (index: number): string => {
  const filler = `// ${'x'.repeat(96)}\n`;
  return `export const v${String(index)} = ${String(index)};\n${filler.repeat(
    Math.ceil(FILE_BYTES / filler.length),
  )}`;
};

describe('indexRepository memory profile (PRD §33)', () => {
  let repoDir: string;
  let stateDir: string;
  let store: IndexStorePort;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-mem-repo-'));
    stateDir = mkdtempSync(join(tmpdir(), 'impactgraph-mem-state-'));
    mkdirSync(join(repoDir, 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'package.json'), '{"name":"memory-fixture"}\n');
    for (let index = 0; index < FILE_COUNT; index += 1) {
      writeFileSync(join(repoDir, 'src', `m${String(index)}.ts`), bulkyModule(index));
    }
    store = unwrap(openSqliteIndexStore(join(stateDir, 'index.sqlite')), 'open store');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('never holds the whole repository in memory at once', async () => {
    const collect = globalThis.gc;
    if (collect === undefined) {
      throw new Error('this test needs --expose-gc (see the analyzers project in vitest.config)');
    }
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    collect();
    const baseline = process.memoryUsage().heapUsed;
    let peakLiveBytes = 0;

    const summary = unwrap(
      await indexRepository(
        {
          rootDir: repoDir,
          snapshot,
          analysisRunId: 'run-memory',
          createdAt: '2026-07-31T10:00:00.000Z',
          // Sampling every file would make the collection cost dominate the run; every 80th
          // still straddles the whole parse loop, which is where retention would show.
          onProgress: (progress) => {
            if (progress.filesProcessed % 80 !== 0) {
              return;
            }
            collect();
            peakLiveBytes = Math.max(peakLiveBytes, process.memoryUsage().heapUsed - baseline);
          },
        },
        { store, registry },
      ),
      'index',
    );

    expect(summary.fileCount).toBe(FILE_COUNT + 1);
    expect(CONTENT_BYTES).toBeGreaterThan(LIVE_BUDGET_BYTES * 4); // the fixture must be able to fail it
    expect(peakLiveBytes).toBeLessThan(LIVE_BUDGET_BYTES);
  });
});
