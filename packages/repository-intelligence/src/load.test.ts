import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import { createAdapterRegistry, createTypeScriptAdapter } from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { RepositorySnapshot } from '@impactgraph/domain';

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const FILE_COUNT = 5000;
const BUDGET_MS = 120_000; // PRD §33: initial index of 5,000 files < 2 min (product target)

const snapshot: RepositorySnapshot = unwrap(
  createRepositorySnapshot({
    id: 'snap-load',
    repositoryIdentity: '/work/synthetic-5k',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
  }),
  'snapshot',
);

describe('load: 5,000-file synthetic monorepo (PRD §33, Story 2.6)', () => {
  let dir: string;
  let dbDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-load-'));
    dbDir = mkdtempSync(join(tmpdir(), 'impactgraph-load-db-'));
    writeFileSync(join(dir, 'package.json'), '{"name":"synthetic-5k","private":true}\n');
    for (let index = 0; index < FILE_COUNT; index += 1) {
      const moduleDir = join(dir, 'src', `mod${String(index % 50)}`);
      mkdirSync(moduleDir, { recursive: true });
      const importLine =
        index > 0 && index % 10 !== 0
          ? `import { value${String(index - 1)} } from './file${String(index - 1)}';\n`
          : '';
      const usage = importLine === '' ? String(index) : `value${String(index - 1)} + 1`;
      writeFileSync(
        join(dir, 'src', `mod${String(index % 50)}`, `file${String(index)}.ts`),
        `${importLine}export const value${String(index)} = ${usage};\n` +
          `export function compute${String(index)}(): number {\n  return value${String(index)};\n}\n`,
      );
    }
  }, 60000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('initial index completes within the §33 budget', async () => {
    const store = unwrap(openSqliteIndexStore(join(dbDir, 'index.sqlite')), 'store');
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    const started = Date.now();
    const summary = unwrap(
      await indexRepository(
        {
          rootDir: dir,
          snapshot,
          analysisRunId: 'run-load',
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        { store, registry },
      ),
      'indexRepository',
    );
    const durationMs = Date.now() - started;
    await store.close();

    expect(summary.fileCount).toBeGreaterThanOrEqual(FILE_COUNT);
    expect(summary.nodeCount).toBeGreaterThan(FILE_COUNT * 2); // file + const + function each
    expect(durationMs).toBeLessThan(BUDGET_MS);
  }, 150000);

  it('incremental update after touching one file stays under the 3 s budget (§33)', async () => {
    writeFileSync(
      join(dir, 'src', 'mod0', 'file0.ts'),
      'export const value0 = 42;\nexport function compute0(): number {\n  return value0;\n}\n',
    );
    const incrementalSnapshot = unwrap(
      createRepositorySnapshot({
        id: 'snap-load-2',
        repositoryIdentity: '/work/synthetic-5k',
        head: { kind: 'branch', branch: 'main', commitSha: 'abc124' },
        dirtyWorkingTree: false,
        indexVersion: 1,
        createdAt: '2026-08-01T11:00:00.000Z',
      }),
      'snapshot',
    );
    const store = unwrap(openSqliteIndexStore(join(dbDir, 'index.sqlite')), 'store');
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    const started = Date.now();
    const summary = unwrap(
      await indexRepository(
        {
          rootDir: dir,
          snapshot: incrementalSnapshot,
          analysisRunId: 'run-load-2',
          createdAt: '2026-08-01T11:00:00.000Z',
        },
        { store, registry },
      ),
      'incremental indexRepository',
    );
    const durationMs = Date.now() - started;
    await store.close();

    expect(summary.changedFileCount).toBe(1);
    expect(summary.reusedFileCount).toBe(summary.fileCount - 1);
    expect(durationMs).toBeLessThan(3000);
  }, 30000);
});
