import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import { createNestJsAdapter } from '@impactgraph/framework-adapters';
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
    id: 'snap-nest',
    repositoryIdentity: '/fixtures/nestjs-app',
    head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
    dirtyWorkingTree: false,
    indexVersion: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
  }),
  'snapshot',
);

describe('NestJS enrichment on the nestjs-app fixture (Stories 3.1 + 3.2)', () => {
  let dir: string;
  let store: IndexStorePort;
  let graph: StoredGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-nest-'));
    store = unwrap(openSqliteIndexStore(join(dir, 'index.sqlite')), 'store');
    const registry = unwrap(createAdapterRegistry([createTypeScriptAdapter()]), 'registry');
    unwrap(
      await indexRepository(
        {
          rootDir: fixtureRepoPath('nestjs-app'),
          snapshot,
          analysisRunId: 'run-nest',
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        { store, registry, frameworkAdapters: [createNestJsAdapter()] },
      ),
      'indexRepository',
    );
    graph = unwrap(await store.loadGraph('snap-nest' as RepositorySnapshotId), 'loadGraph');
  });

  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects routes with controller prefixes as api-endpoint nodes with EXPOSES edges', () => {
    const routes = graph.nodes.filter((node) => node.id.startsWith('route:'));
    expect(routes.map((node) => node.name).sort()).toEqual([
      'GET /deals',
      'GET /deals/:id',
      'POST /deals',
    ]);
    for (const route of routes) {
      expect(route.type).toBe('api-endpoint');
      expect(route.knowledge.provenance).toBe('framework-convention');
      expect(route.knowledge.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'EXPOSES' &&
          edge.sourceId === 'symbol:src/deals/deals.controller.ts#DealsController.findAll' &&
          edge.targetId === 'route:GET /deals',
      ),
    ).toBe(true);
  });

  it('resolves module structure into OWNS and DEPENDS_ON edges', () => {
    const edgeSummaries = graph.edges.map(
      (edge) => `${edge.type}:${edge.sourceId}->${edge.targetId}`,
    );
    expect(edgeSummaries).toContain(
      'OWNS:symbol:src/deals/deals.module.ts#DealsModule->symbol:src/deals/deals.controller.ts#DealsController',
    );
    expect(edgeSummaries).toContain(
      'OWNS:symbol:src/deals/deals.module.ts#DealsModule->symbol:src/deals/deals.service.ts#DealsService',
    );
    expect(edgeSummaries).toContain(
      'DEPENDS_ON:symbol:src/app.module.ts#AppModule->symbol:src/deals/deals.module.ts#DealsModule',
    );
  });

  it('DI becomes a USES edge from the language-level injection fact', () => {
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'USES' &&
          edge.sourceId === 'symbol:src/deals/deals.controller.ts#DealsController' &&
          edge.targetId === 'symbol:src/deals/deals.service.ts#DealsService',
      ),
    ).toBe(true);
  });

  it('detects scheduled jobs and event subscriptions', () => {
    const job = graph.nodes.find((node) =>
      node.id.startsWith('job:symbol:src/deals/deals.service.ts#DealsService.refreshExpired'),
    );
    expect(job?.type).toBe('job');
    expect(graph.edges.some((edge) => edge.type === 'TRIGGERS' && edge.sourceId === job?.id)).toBe(
      true,
    );

    const topic = graph.nodes.find((node) => node.id === 'topic:deal.updated');
    expect(topic?.type).toBe('topic');
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'SUBSCRIBES_TO' &&
          edge.sourceId === 'symbol:src/deals/deals.service.ts#DealsService.onDealUpdated' &&
          edge.targetId === 'topic:deal.updated',
      ),
    ).toBe(true);
  });

  it('every enrichment fact is framework-convention with decorator evidence', () => {
    const frameworkEdges = graph.edges.filter((edge) => edge.id.startsWith('nestjs:'));
    expect(frameworkEdges.length).toBeGreaterThanOrEqual(6);
    for (const edge of frameworkEdges) {
      expect(edge.knowledge.provenance).toBe('framework-convention');
      expect(edge.knowledge.evidenceIds.length).toBeGreaterThan(0);
    }
  });
});
