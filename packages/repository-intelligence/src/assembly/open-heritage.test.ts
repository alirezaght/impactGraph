import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import {
  createAdapterRegistry,
  createPythonAdapter,
  createTypeScriptAdapter,
} from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { indexRepository } from '../index.js';

import type { IndexStorePort, StoredGraph } from '@impactgraph/application';
import type { RepositorySnapshot } from '@impactgraph/domain';

// The SqlOutboundQueueRepository.list_rows field failure: a heritage reference whose target could
// not be resolved used to become a warning and NOTHING else, so the graph could not distinguish
// "this class has exactly these members" from "this class inherits members the index cannot see".
// Assembly now models the unresolved supertype as an `unresolved-external-boundary` node with a
// real EXTENDS/IMPLEMENTS edge, which is what lets a member check answer "could not verify"
// instead of fabricating nonexistence.

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const snapshotFor = (id: string): RepositorySnapshot =>
  unwrap(
    createRepositorySnapshot({
      id,
      repositoryIdentity: `/tmp/${id}`,
      head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
      dirtyWorkingTree: false,
      indexVersion: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
    }),
    'snapshot',
  );

const open: IndexStorePort[] = [];
const dirs: string[] = [];

const indexFiles = async (
  id: string,
  files: Readonly<Record<string, string>>,
): Promise<StoredGraph> => {
  const dir = mkdtempSync(join(tmpdir(), 'impactgraph-heritage-'));
  dirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  const storeDir = mkdtempSync(join(tmpdir(), 'impactgraph-heritage-db-'));
  dirs.push(storeDir);
  const store = unwrap(openSqliteIndexStore(join(storeDir, 'index.sqlite')), 'store');
  open.push(store);
  const registry = unwrap(
    createAdapterRegistry([createTypeScriptAdapter(), createPythonAdapter()]),
    'registry',
  );
  const snapshot = snapshotFor(id);
  unwrap(
    await indexRepository(
      {
        rootDir: dir,
        snapshot,
        analysisRunId: `run-${id}`,
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      { store, registry, frameworkAdapters: [] },
    ),
    'indexRepository',
  );
  return unwrap(await store.loadGraph(snapshot.id), 'loadGraph');
};

const edgeSummaries = (graph: StoredGraph, type: string): readonly string[] =>
  graph.edges
    .filter((edge) => edge.type === type)
    .map((edge) => `${edge.sourceId}->${edge.targetId}`)
    .sort();

afterEach(async () => {
  await Promise.all(open.splice(0).map((store) => store.close()));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('unresolved heritage becomes an explicit open boundary (PRD §34 — never guess, never drop)', () => {
  it('Python: an in-repo mixin resolves fully — EXTENDS edge plus method CONTAINS', async () => {
    const graph = await indexFiles('snap-heritage-py-mixin', {
      'pyproject.toml': '[project]\nname = "mixin-py"\nversion = "1.0.0"\n',
      'app/__init__.py': '',
      'app/mixins.py':
        'class OutboundAuditReadsMixin:\n    def list_rows(self, limit):\n        return []\n',
      'app/repository.py':
        'from app.mixins import OutboundAuditReadsMixin\n\n\n' +
        'class SqlOutboundQueueRepository(OutboundAuditReadsMixin):\n' +
        '    def save(self, row):\n        pass\n',
    });
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:app/repository.py#SqlOutboundQueueRepository->symbol:app/mixins.py#OutboundAuditReadsMixin',
    ]);
    expect(edgeSummaries(graph, 'CONTAINS')).toContain(
      'symbol:app/mixins.py#OutboundAuditReadsMixin->symbol:app/mixins.py#OutboundAuditReadsMixin.list_rows',
    );
    const method = graph.nodes.find(
      (node) => node.id === 'symbol:app/mixins.py#OutboundAuditReadsMixin.list_rows',
    );
    expect(method?.type).toBe('method');
    // Everything resolved — no open boundary was invented.
    expect(graph.nodes.filter((node) => node.type === 'unresolved-external-boundary')).toEqual([]);
  });

  it('Python: a base from outside the index becomes an unresolved-external-boundary supertype', async () => {
    const graph = await indexFiles('snap-heritage-py-open', {
      'pyproject.toml': '[project]\nname = "open-py"\nversion = "1.0.0"\n',
      'app/__init__.py': '',
      'app/repository.py':
        'from vendorlib.audit import OutboundAuditReadsMixin\n\n\n' +
        'class SqlOutboundQueueRepository(OutboundAuditReadsMixin):\n' +
        '    def save(self, row):\n        pass\n',
    });
    const boundary = graph.nodes.find((node) => node.type === 'unresolved-external-boundary');
    expect(boundary?.name).toBe('OutboundAuditReadsMixin');
    expect(boundary?.category).toBe('integration');
    expect(boundary?.knowledge.provenance).toBe('static-analysis');
    expect(boundary?.knowledge.evidenceIds.length).toBeGreaterThan(0);
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      `symbol:app/repository.py#SqlOutboundQueueRepository->${boundary?.id ?? ''}`,
    ]);
  });

  it('TypeScript: an unresolvable `implements` produces an IMPLEMENTS edge to the boundary', async () => {
    const graph = await indexFiles('snap-heritage-ts-open', {
      'package.json': JSON.stringify({ name: 'open-ts', version: '1.0.0' }),
      'src/repo.ts':
        "import { AuditReads } from 'vendorlib';\n\nexport class DealRepository implements AuditReads {}\n",
    });
    const boundary = graph.nodes.find((node) => node.type === 'unresolved-external-boundary');
    expect(boundary?.name).toBe('AuditReads');
    expect(edgeSummaries(graph, 'IMPLEMENTS')).toEqual([
      `symbol:src/repo.ts#DealRepository->${boundary?.id ?? ''}`,
    ]);
  });

  it('never invents boundaries for non-heritage references — an unresolved call stays a warning', async () => {
    const graph = await indexFiles('snap-heritage-ts-call', {
      'package.json': JSON.stringify({ name: 'call-ts', version: '1.0.0' }),
      'src/user.ts':
        "import { helper } from 'vendorlib';\n\nexport const run = (): void => {\n  helper();\n};\n",
    });
    expect(graph.nodes.filter((node) => node.type === 'unresolved-external-boundary')).toEqual([]);
  });
});
