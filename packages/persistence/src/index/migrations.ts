import type { Database } from 'better-sqlite3';

// Numbered forward migrations tracked via PRAGMA user_version, each applied in a transaction
// (local-artifact-persistence skill). Never edit an existing entry — append a new one.
const MIGRATIONS: readonly string[] = [
  `
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
  CREATE INDEX idx_nodes_snapshot ON nodes(snapshot_id);
  CREATE INDEX idx_edges_snapshot ON edges(snapshot_id);
  CREATE INDEX idx_evidence_snapshot ON evidence(snapshot_id);
  `,
  // v2 — incremental indexing (PRD §32): per-snapshot content hashes, a snapshot-neutral
  // fragment cache keyed by (file, content hash), and the current-generation pointer that
  // moves only inside a successful index transaction (PRD §34).
  `
  CREATE TABLE file_hashes (
    snapshot_id  TEXT NOT NULL REFERENCES snapshots(id),
    file_path    TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, file_path)
  );
  CREATE TABLE fragment_cache (
    file_path    TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    payload      TEXT NOT NULL,
    PRIMARY KEY (file_path, content_hash)
  );
  CREATE TABLE index_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export const runMigrations = (db: Database): void => {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) {
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${String(version + 1)}`);
    })();
  }
};
