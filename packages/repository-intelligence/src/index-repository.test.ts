import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import { createGenericDetectorsAdapter } from '@impactgraph/framework-adapters';
import {
  createAdapterRegistry,
  createPrismaAdapter,
  createTypeScriptAdapter,
} from '@impactgraph/language-adapters';
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

const snapshot: RepositorySnapshot = unwrap(
  createRepositorySnapshot({
    id: 'snap-fixture',
    repositoryIdentity: '/fixtures/ts-basic',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-07-31T10:00:00.000Z',
  }),
  'snapshot',
);

describe('indexRepository end-to-end on ts-basic (Stories 2.1 + 2.3 + 2.4)', () => {
  let dir: string;
  let store: IndexStorePort;
  let summary: IndexSummary;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-e2e-'));
    store = unwrap(openSqliteIndexStore(join(dir, 'index.sqlite')), 'open store');
    const registry = unwrap(
      createAdapterRegistry([createTypeScriptAdapter(), createPrismaAdapter()]),
      'registry',
    );
    summary = unwrap(
      await indexRepository(
        {
          rootDir: fixtureRepoPath('ts-basic'),
          snapshot,
          analysisRunId: 'run-e2e',
          createdAt: '2026-07-31T10:00:00.000Z',
        },
        { store, registry, frameworkAdapters: [createGenericDetectorsAdapter()] },
      ),
      'indexRepository',
    );
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const loadPersistedGraph = async () => {
    return unwrap(await store.loadGraph('snap-fixture' as RepositorySnapshotId), 'loadGraph');
  };

  it('indexes the fixture without touching ignored or secret files', async () => {
    const graph = await loadPersistedGraph();
    const ids = graph.nodes.map((n) => n.id);
    expect(ids.some((id) => id.includes('node_modules'))).toBe(false);
    expect(ids.some((id) => id.includes('.env'))).toBe(false);
    expect(summary.ignoredCount).toBeGreaterThan(0);
    expect(summary.fileCount).toBeGreaterThanOrEqual(8);
  });

  it('resolves relative, barrel, and tsconfig-alias imports into IMPORTS edges', async () => {
    const graph = await loadPersistedGraph();
    const importEdges = graph.edges.filter((e) => e.type === 'IMPORTS').map((e) => e.id);
    expect(importEdges).toContain('imports:src/services/deal-service.ts->src/lib/base-service.ts');
    expect(importEdges).toContain('imports:src/services/deal-service.ts->src/lib/index.ts');
    expect(importEdges).toContain('imports:src/lib/index.ts->src/lib/deal-repository.ts');
    expect(importEdges).toContain('imports:src/index.ts->src/services/deal-service.ts');
    // '@lib/deal-repository' via tsconfig paths:
    expect(importEdges).toContain('imports:src/alias-user.ts->src/lib/deal-repository.ts');
  });

  it('resolves EXTENDS and IMPLEMENTS across files, including through the barrel', async () => {
    const graph = await loadPersistedGraph();
    const edgeIds = graph.edges.map((e) => e.id);
    expect(edgeIds).toContain(
      'extends:symbol:src/services/deal-service.ts#DealService->symbol:src/lib/base-service.ts#BaseService',
    );
    expect(edgeIds).toContain(
      'implements:symbol:src/services/deal-service.ts#DealService->symbol:src/lib/base-service.ts#Searchable',
    );
  });

  it('emits package facts with configuration provenance', async () => {
    const graph = await loadPersistedGraph();
    const pkg = graph.nodes.find((n) => n.id === 'package:ts-basic');
    expect(pkg?.type).toBe('package');
    expect(pkg?.knowledge.provenance).toBe('configuration');
    expect(
      graph.edges.some(
        (e) =>
          e.type === 'CONTAINS' &&
          e.sourceId === 'package:ts-basic' &&
          e.targetId === 'file:src/services/deal-service.ts',
      ),
    ).toBe(true);
  });

  it('discovers source roots and build config for the package (Story 2.1, §15.1)', async () => {
    const graph = await loadPersistedGraph();

    // src/ exists on disk → directory node (static-analysis) contained by the package.
    const srcRoot = graph.nodes.find((n) => n.id === 'directory:src');
    expect(srcRoot?.type).toBe('directory');
    expect(srcRoot?.knowledge.provenance).toBe('static-analysis');
    expect(
      graph.edges.some(
        (e) =>
          e.type === 'CONTAINS' &&
          e.sourceId === 'package:ts-basic' &&
          e.targetId === 'directory:src',
      ),
    ).toBe(true);
    // Conventional roots absent from the fixture are never invented.
    expect(graph.nodes.some((n) => n.id === 'directory:test')).toBe(false);

    // Manifest-adjacent build config → CONFIGURES edges onto the owning package.
    const configures = graph.edges.filter(
      (e) => e.type === 'CONFIGURES' && e.targetId === 'package:ts-basic',
    );
    expect(configures.map((e) => e.sourceId).sort()).toEqual([
      'file:Dockerfile',
      'file:tsconfig.json',
    ]);
    for (const edge of configures) {
      expect(edge.knowledge.provenance).toBe('configuration');
    }

    // ts-basic declares no main/module/bin/exports → no EXPOSES edges, never guessed.
    expect(graph.edges.some((e) => e.type === 'EXPOSES')).toBe(false);
  });

  it('binds every persisted fact to the snapshot with deterministic provenance', async () => {
    const graph = await loadPersistedGraph();
    expect(graph.nodes.length).toBeGreaterThan(10);
    for (const record of [...graph.nodes, ...graph.edges]) {
      expect(record.knowledge.repositorySnapshotId).toBe('snap-fixture');
      expect(['static-analysis', 'configuration', 'framework-convention']).toContain(
        record.knowledge.provenance,
      );
    }
    expect(summary.nodeCount).toBe(graph.nodes.length);
    expect(summary.edgeCount).toBe(graph.edges.length);
  });

  it('extracts calls, routes, data models, and test links (Story 2.5)', async () => {
    const graph = await loadPersistedGraph();
    const edgeIds = graph.edges.map((edge) => edge.id);

    // CALLS: local `new DealService(...)` and barrel-imported `new DealRepository(...)`.
    expect(edgeIds).toContain(
      'calls:symbol:src/services/deal-service.ts#buildDealService->symbol:src/services/deal-service.ts#DealService',
    );
    expect(edgeIds).toContain(
      'calls:symbol:src/services/deal-service.ts#buildDealService->symbol:src/lib/deal-repository.ts#DealRepository',
    );

    // TESTS: the test file imports the module it tests (framework-convention).
    const testsEdge = graph.edges.find(
      (edge) => edge.id === 'tests:src/services/deal-service.test.ts->src/services/deal-service.ts',
    );
    expect(testsEdge?.type).toBe('TESTS');
    expect(testsEdge?.knowledge.provenance).toBe('framework-convention');
    const testFile = graph.nodes.find(
      (node) => node.id === 'file:src/services/deal-service.test.ts',
    );
    expect(testFile?.type).toBe('test');

    // Data models from the Prisma schema.
    const dealModel = graph.nodes.find((node) => node.id === 'datamodel:prisma/schema.prisma#Deal');
    expect(dealModel?.type).toBe('table');
    expect(dealModel?.knowledge.provenance).toBe('configuration');

    // Generic route detection: exported handler under src/api/.
    const endpoint = graph.nodes.find((node) => node.id === 'symbol:src/api/deals.ts#getDeals');
    expect(endpoint?.type).toBe('api-endpoint');
  });

  it('generic detectors: env vars, migrations, Docker, CI (Story 3.4)', async () => {
    const graph = await loadPersistedGraph();

    // process.env.X → environment-variable node + CONFIGURES edge (static-analysis).
    const envVar = graph.nodes.find((node) => node.id === 'env:DATABASE_URL');
    expect(envVar?.type).toBe('environment-variable');
    expect(graph.nodes.some((node) => node.id === 'env:SEARCH_INDEX')).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'CONFIGURES' &&
          edge.sourceId === 'env:DATABASE_URL' &&
          edge.targetId === 'file:src/config.ts',
      ),
    ).toBe(true);

    // Migration file → migration node with MIGRATES edges to the Prisma tables.
    const migration = graph.nodes.find(
      (node) => node.id === 'migration:prisma/migrations/20260801000000_init/migration.sql',
    );
    expect(migration?.type).toBe('migration');
    const migrates = graph.edges.filter(
      (edge) => edge.type === 'MIGRATES' && edge.sourceId === migration?.id,
    );
    expect(migrates.map((edge) => edge.targetId).sort()).toEqual([
      'datamodel:prisma/schema.prisma#Deal',
      'datamodel:prisma/schema.prisma#User',
    ]);

    // Dockerfile and CI workflow → coarse infrastructure nodes.
    expect(graph.nodes.find((node) => node.id === 'docker:Dockerfile')?.type).toBe('docker-image');
    expect(graph.nodes.find((node) => node.id === 'pipeline:.github/workflows/ci.yml')?.type).toBe(
      'deployment-pipeline',
    );
  });
});
