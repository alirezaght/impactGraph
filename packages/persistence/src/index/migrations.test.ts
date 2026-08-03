import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSqliteIndexStore } from '../index.js';

// Recreates the exact v1 schema as it existed before migration #2 shipped — a frozen fixture,
// never updated when the current schema changes (local-artifact-persistence skill).
const V1_SCHEMA = `
  CREATE TABLE snapshots (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload    TEXT NOT NULL
  );
  CREATE TABLE nodes (
    id          TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    category    TEXT NOT NULL,
    type        TEXT NOT NULL,
    name        TEXT NOT NULL,
    path        TEXT,
    provenance  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id)
  );
  CREATE TABLE edges (
    id          TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    type        TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    provenance  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id)
  );
  CREATE TABLE evidence (
    id          TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    kind        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id)
  );
`;

const V1_SNAPSHOT_PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  id: 'snap-v1',
  repositoryIdentity: '/old/repo',
  head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
  dirtyWorkingTree: false,
  indexVersion: 1,
  createdAt: '2026-07-01T10:00:00.000Z',
});

describe('index store migrations', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-migrate-'));
    dbPath = join(dir, 'index.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('upgrades a v1 database in place, preserving its data', async () => {
    const v1 = new Database(dbPath);
    v1.exec(V1_SCHEMA);
    v1.prepare('INSERT INTO snapshots (id, created_at, payload) VALUES (?, ?, ?)').run(
      'snap-v1',
      '2026-07-01T10:00:00.000Z',
      V1_SNAPSHOT_PAYLOAD,
    );
    v1.pragma('user_version = 1');
    v1.close();

    const opened = openSqliteIndexStore(dbPath);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const store = opened.value;
    const snapshots = await store.listSnapshots();
    expect(snapshots.ok && snapshots.value.map((s) => s.id)).toEqual(['snap-v1']);

    // v2 capabilities usable on the upgraded database:
    const current = await store.getCurrentSnapshotId();
    expect(current.ok && current.value).toBeUndefined();
    const cached = await store.cacheFragments([
      { filePath: 'a.ts', contentHash: 'h1', payload: '{"schemaVersion":1}' },
    ]);
    expect(cached.ok).toBe(true);
    await store.close();
  });
});
