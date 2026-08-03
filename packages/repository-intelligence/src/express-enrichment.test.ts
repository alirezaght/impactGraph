import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import { createExpressAdapter } from '@impactgraph/framework-adapters';
import { createAdapterRegistry, createTypeScriptAdapter } from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { IndexStorePort, StoredGraph } from '@impactgraph/application';
import type { RepositorySnapshot, RepositorySnapshotId } from '@impactgraph/domain';

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const snapshot: RepositorySnapshot = unwrap(
  createRepositorySnapshot({
    id: 'snap-express',
    repositoryIdentity: '/fixtures/express-app',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
  }),
  'snapshot',
);

describe('Express enrichment on the express-app fixture (Story 3.3)', () => {
  let dir: string;
  let store: IndexStorePort;
  let graph: StoredGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-express-'));
    store = unwrap(openSqliteIndexStore(join(dir, 'index.sqlite')), 'store');
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    unwrap(
      await indexRepository(
        {
          rootDir: fixtureRepoPath('express-app'),
          snapshot,
          analysisRunId: 'run-express',
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        { store, registry, frameworkAdapters: [createExpressAdapter()] },
      ),
      'indexRepository',
    );
    graph = unwrap(await store.loadGraph('snap-express' as RepositorySnapshotId), 'loadGraph');
  });

  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('mounted routers resolve to full route paths (app.use + router registrations)', () => {
    const routes = graph.nodes.filter((node) => node.id.startsWith('route:'));
    expect(routes.map((node) => node.name).sort()).toEqual([
      'GET /deals',
      'GET /deals/:id',
      'GET /health',
      'POST /deals',
    ]);
    for (const route of routes) {
      expect(route.type).toBe('api-endpoint');
      expect(route.knowledge.provenance).toBe('framework-convention');
    }
  });

  it('EXPOSES edges connect handler symbols and registering files to routes', () => {
    const summaries = graph.edges
      .filter((edge) => edge.type === 'EXPOSES')
      .map((edge) => `${edge.sourceId}->${edge.targetId}`);
    expect(summaries).toContain('symbol:src/deals-router.ts#listDeals->route:GET /deals');
    expect(summaries).toContain('symbol:src/server.ts#healthCheck->route:GET /health');
    expect(summaries).toContain('file:src/deals-router.ts->route:POST /deals');
  });

  it('application middleware becomes a USES edge to the resolved symbol', () => {
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'USES' &&
          edge.sourceId === 'file:src/server.ts' &&
          edge.targetId === 'symbol:src/middleware.ts#logRequests',
      ),
    ).toBe(true);
  });

  it('middleware chain order is modeled: earlier middleware TRIGGERS the next (§12.2)', () => {
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'TRIGGERS' &&
          edge.sourceId === 'symbol:src/middleware.ts#logRequests' &&
          edge.targetId === 'symbol:src/middleware.ts#authenticate' &&
          edge.knowledge.provenance === 'framework-convention',
      ),
    ).toBe(true);
  });
});
