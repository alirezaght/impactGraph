import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createEvidenceRecord,
  createGraphEdge,
  createGraphNode,
  createRepositorySnapshot,
} from '@impactgraph/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSqliteIndexStore } from '../index.js';

import type { IndexStorePort } from '@impactgraph/application';
import type {
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  RepositorySnapshot,
  RepositorySnapshotId,
} from '@impactgraph/domain';

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const knowledge = (snapshotId: string) => ({
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: snapshotId,
  analysisRunId: 'run-1',
});

const snapshot = (id: string, createdAt = '2026-07-31T10:00:00.000Z'): RepositorySnapshot =>
  unwrap(
    createRepositorySnapshot({
      id,
      repositoryIdentity: '/repo/root',
      head: { kind: 'branch', branch: 'main', commitSha: '4f8a29c' },
      dirtyWorkingTree: false,
      indexVersion: 1,
      createdAt,
    }),
    `snapshot ${id}`,
  );

const node = (id: string, snapshotId: string, name = id): GraphNode =>
  unwrap(
    createGraphNode({
      id,
      category: 'application',
      type: 'service',
      name,
      knowledge: knowledge(snapshotId),
    }),
    `node ${id}`,
  );

const edge = (id: string, from: string, to: string, snapshotId: string): GraphEdge =>
  unwrap(
    createGraphEdge({
      id,
      type: 'IMPORTS',
      sourceId: from,
      targetId: to,
      knowledge: knowledge(snapshotId),
    }),
    `edge ${id}`,
  );

const evidence = (id: string, snapshotId: string): EvidenceRecord =>
  unwrap(
    createEvidenceRecord({
      id,
      kind: 'import-statement',
      source: { kind: 'file', filePath: 'src/a.ts', symbolName: 'A' },
      repositorySnapshotId: snapshotId,
      createdAt: '2026-07-31T10:00:00.000Z',
    }),
    `evidence ${id}`,
  );

const snapId = (id: string): RepositorySnapshotId => id as RepositorySnapshotId;

describe('SqliteIndexStore (Story 1.2)', () => {
  let dir: string;
  let dbPath: string;
  let store: IndexStorePort;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-index-'));
    dbPath = join(dir, 'index.sqlite');
    store = unwrap(openSqliteIndexStore(dbPath), 'open store');
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists and reloads a snapshot with its graph (round-trip through validation)', async () => {
    const snap = snapshot('snap-1');
    const update = {
      snapshot: snap,
      nodes: [node('a', 'snap-1'), node('b', 'snap-1')],
      edges: [edge('e1', 'a', 'b', 'snap-1')],
      evidence: [evidence('ev-1', 'snap-1')],
    };
    expect((await store.applyIndexUpdate(update)).ok).toBe(true);

    const graph = unwrap(await store.loadGraph(snapId('snap-1')), 'loadGraph');
    expect(graph.nodes).toEqual(update.nodes);
    expect(graph.edges).toEqual(update.edges);

    const restored = unwrap(await store.getSnapshot(snapId('snap-1')), 'getSnapshot');
    expect(restored).toEqual(snap);

    const ev = unwrap(await store.getEvidence(update.evidence.map((e) => e.id)), 'getEvidence');
    expect(ev).toEqual(update.evidence);
  });

  it('batch upsert replaces records with the same id for the same snapshot', async () => {
    const snap = snapshot('snap-1');
    await store.applyIndexUpdate({
      snapshot: snap,
      nodes: [node('a', 'snap-1', 'OldName')],
      edges: [],
      evidence: [],
    });
    await store.applyIndexUpdate({
      snapshot: snap,
      nodes: [node('a', 'snap-1', 'NewName')],
      edges: [],
      evidence: [],
    });
    const graph = unwrap(await store.loadGraph(snapId('snap-1')), 'loadGraph');
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.name).toBe('NewName');
  });

  it('snapshots are immutable once written — a conflicting rewrite is ignored', async () => {
    await store.applyIndexUpdate({
      snapshot: snapshot('snap-1', '2026-07-31T10:00:00.000Z'),
      nodes: [],
      edges: [],
      evidence: [],
    });
    await store.applyIndexUpdate({
      snapshot: snapshot('snap-1', '2026-08-01T09:00:00.000Z'),
      nodes: [],
      edges: [],
      evidence: [],
    });
    const restored = unwrap(await store.getSnapshot(snapId('snap-1')), 'getSnapshot');
    expect(restored?.createdAt).toBe('2026-07-31T10:00:00.000Z');
  });

  it('lists snapshots newest first, deterministically', async () => {
    await store.applyIndexUpdate({
      snapshot: snapshot('snap-old', '2026-07-30T10:00:00.000Z'),
      nodes: [],
      edges: [],
      evidence: [],
    });
    await store.applyIndexUpdate({
      snapshot: snapshot('snap-new', '2026-07-31T10:00:00.000Z'),
      nodes: [],
      edges: [],
      evidence: [],
    });
    const list = unwrap(await store.listSnapshots(), 'listSnapshots');
    expect(list.map((s) => s.id)).toEqual(['snap-new', 'snap-old']);
  });

  it('a failed batch never corrupts the previous valid state (PRD §34)', async () => {
    const snap = snapshot('snap-1');
    await store.applyIndexUpdate({
      snapshot: snap,
      nodes: [node('a', 'snap-1')],
      edges: [],
      evidence: [],
    });

    const poisoned = { ...node('b', 'snap-1'), name: 123 as never };
    const result = await store.applyIndexUpdate({
      snapshot: snap,
      nodes: [node('c', 'snap-1'), poisoned],
      edges: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }

    // Previous state intact; nothing from the failed batch (not even the valid 'c') persisted.
    const graph = unwrap(await store.loadGraph(snapId('snap-1')), 'loadGraph');
    expect(graph.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('survives reopening: data persists and migrations are idempotent', async () => {
    const snap = snapshot('snap-1');
    await store.applyIndexUpdate({
      snapshot: snap,
      nodes: [node('a', 'snap-1')],
      edges: [],
      evidence: [],
    });
    await store.close();

    store = unwrap(openSqliteIndexStore(dbPath), 'reopen store');
    const graph = unwrap(await store.loadGraph(snapId('snap-1')), 'loadGraph after reopen');
    expect(graph.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('quarantines a corrupt database file instead of losing it (PRD §34)', async () => {
    await store.close();
    writeFileSync(dbPath, 'this is not a sqlite database — garbage bytes');

    store = unwrap(openSqliteIndexStore(dbPath), 'open over corrupt file');
    const list = unwrap(await store.listSnapshots(), 'listSnapshots on fresh store');
    expect(list).toEqual([]);

    const quarantined = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(quarantined.length).toBe(1);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('a non-corruption open failure surfaces as itself, not as false corruption (§34)', () => {
    // Fully self-contained: touching the suite's shared store here risks leaving it closed for
    // afterEach if an assertion throws, which is exactly how a "flaky" test is born.
    const own = mkdtempSync(join(tmpdir(), 'impactgraph-openfail-'));
    try {
      // A path whose PARENT is a regular file can neither be created nor opened — and there is
      // no database file there to quarantine. The old recovery path renamed unconditionally and
      // reported the resulting ENOENT, hiding the real cause.
      const blocker = join(own, 'blocker');
      writeFileSync(blocker, 'not a directory');
      const opened = openSqliteIndexStore(join(blocker, 'index.sqlite'));
      expect(opened.ok).toBe(false);
      if (!opened.ok) {
        expect(opened.error.message).toContain('failed to open index store');
        expect(opened.error.message).not.toContain('.corrupt-');
      }
      // nothing was quarantined, because nothing was corrupt
      expect(readdirSync(own).filter((f) => f.includes('.corrupt-'))).toEqual([]);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it('returns an empty graph for an unknown snapshot and undefined for a missing snapshot', async () => {
    const graph = unwrap(await store.loadGraph(snapId('ghost')), 'loadGraph ghost');
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    const missing = unwrap(await store.getSnapshot(snapId('ghost')), 'getSnapshot ghost');
    expect(missing).toBeUndefined();
  });
});
