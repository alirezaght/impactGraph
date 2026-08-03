import { storageError } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';

import {
  edgeFromPayload,
  edgeToRow,
  evidenceFromPayload,
  evidenceToRow,
  nodeFromPayload,
  nodeToRow,
  snapshotFromPayload,
  snapshotToRow,
} from './mappers.js';

import type {
  FragmentCacheEntry,
  GraphIndexUpdate,
  IndexRunRecord,
  IndexStorePort,
  StorageError,
  StoredGraph,
} from '@impactgraph/application';
import type {
  EvidenceId,
  EvidenceRecord,
  RepositorySnapshot,
  RepositorySnapshotId,
  Result,
} from '@impactgraph/domain';
import type { Database } from 'better-sqlite3';

const UPSERTS = {
  // Snapshots are immutable once written (Story 1.3): re-applying is idempotent, first write wins.
  snapshot: `INSERT INTO snapshots (id, created_at, payload) VALUES (@id, @created_at, @payload)
    ON CONFLICT(id) DO NOTHING`,
  node: `INSERT INTO nodes (id, snapshot_id, category, type, name, path, provenance, payload)
    VALUES (@id, @snapshot_id, @category, @type, @name, @path, @provenance, @payload)
    ON CONFLICT(id, snapshot_id) DO UPDATE SET category=excluded.category, type=excluded.type,
    name=excluded.name, path=excluded.path, provenance=excluded.provenance, payload=excluded.payload`,
  edge: `INSERT INTO edges (id, snapshot_id, type, source_id, target_id, provenance, payload)
    VALUES (@id, @snapshot_id, @type, @source_id, @target_id, @provenance, @payload)
    ON CONFLICT(id, snapshot_id) DO UPDATE SET type=excluded.type, source_id=excluded.source_id,
    target_id=excluded.target_id, provenance=excluded.provenance, payload=excluded.payload`,
  evidence: `INSERT INTO evidence (id, snapshot_id, kind, payload)
    VALUES (@id, @snapshot_id, @kind, @payload)
    ON CONFLICT(id, snapshot_id) DO UPDATE SET kind=excluded.kind, payload=excluded.payload`,
  fileHash: `INSERT INTO file_hashes (snapshot_id, file_path, content_hash)
    VALUES (@snapshot_id, @file_path, @content_hash)
    ON CONFLICT(snapshot_id, file_path) DO UPDATE SET content_hash=excluded.content_hash`,
  fragment: `INSERT INTO fragment_cache (file_path, content_hash, payload)
    VALUES (@file_path, @content_hash, @payload)
    ON CONFLICT(file_path, content_hash) DO UPDATE SET payload=excluded.payload`,
  state: `INSERT INTO index_state (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
} as const;

interface PayloadRow {
  payload: string;
}

const toStorageError = (error: unknown): StorageError => {
  if (error instanceof Error && error.name === 'ZodError') {
    return storageError('validation', `record failed schema validation: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return storageError('io', message);
};

const collectPayloads = <T>(
  rows: readonly PayloadRow[],
  parse: (payload: string) => Result<T, StorageError>,
): Result<T[], StorageError> => {
  const values: T[] = [];
  for (const row of rows) {
    const parsed = parse(row.payload);
    if (!parsed.ok) {
      return parsed;
    }
    values.push(parsed.value);
  }
  return ok(values);
};

/** IndexStorePort over better-sqlite3. All writes go through one transaction per update. */
export class SqliteIndexStore implements IndexStorePort {
  private readonly db: Database;
  private readonly writeUpdate: (update: GraphIndexUpdate) => void;

  public constructor(db: Database) {
    this.db = db;
    const statements = {
      snapshot: db.prepare(UPSERTS.snapshot),
      node: db.prepare(UPSERTS.node),
      edge: db.prepare(UPSERTS.edge),
      evidence: db.prepare(UPSERTS.evidence),
      fileHash: db.prepare(UPSERTS.fileHash),
      state: db.prepare(UPSERTS.state),
    };
    // Validation runs inside the transaction: one bad record rolls back the whole batch, and
    // the current-snapshot pointer only moves when everything else succeeded (§34).
    this.writeUpdate = db.transaction((update: GraphIndexUpdate) => {
      statements.snapshot.run(snapshotToRow(update.snapshot));
      for (const node of update.nodes) {
        statements.node.run(nodeToRow(node));
      }
      for (const edge of update.edges) {
        statements.edge.run(edgeToRow(edge));
      }
      for (const record of update.evidence) {
        statements.evidence.run(evidenceToRow(record));
      }
      for (const hash of update.fileHashes ?? []) {
        statements.fileHash.run({
          snapshot_id: update.snapshot.id,
          file_path: hash.filePath,
          content_hash: hash.contentHash,
        });
      }
      if (update.markCurrent === true) {
        statements.state.run({ key: 'currentSnapshotId', value: update.snapshot.id });
      }
    });
  }

  public applyIndexUpdate(update: GraphIndexUpdate): Promise<Result<void, StorageError>> {
    try {
      this.writeUpdate(update);
      return Promise.resolve(ok(undefined));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public loadGraph(snapshotId: RepositorySnapshotId): Promise<Result<StoredGraph, StorageError>> {
    try {
      const nodeRows = this.db
        .prepare('SELECT payload FROM nodes WHERE snapshot_id = ? ORDER BY id')
        .all(snapshotId) as PayloadRow[];
      const edgeRows = this.db
        .prepare('SELECT payload FROM edges WHERE snapshot_id = ? ORDER BY id')
        .all(snapshotId) as PayloadRow[];
      const nodes = collectPayloads(nodeRows, nodeFromPayload);
      if (!nodes.ok) {
        return Promise.resolve(nodes);
      }
      const edges = collectPayloads(edgeRows, edgeFromPayload);
      if (!edges.ok) {
        return Promise.resolve(edges);
      }
      return Promise.resolve(ok({ nodes: nodes.value, edges: edges.value }));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getSnapshot(
    id: RepositorySnapshotId,
  ): Promise<Result<RepositorySnapshot | undefined, StorageError>> {
    try {
      const row = this.db.prepare('SELECT payload FROM snapshots WHERE id = ?').get(id) as
        PayloadRow | undefined;
      if (row === undefined) {
        return Promise.resolve(ok(undefined));
      }
      const parsed = snapshotFromPayload(row.payload);
      return Promise.resolve(parsed.ok ? ok(parsed.value) : parsed);
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public listSnapshots(): Promise<Result<readonly RepositorySnapshot[], StorageError>> {
    try {
      const rows = this.db
        .prepare('SELECT payload FROM snapshots ORDER BY created_at DESC, id')
        .all() as PayloadRow[];
      return Promise.resolve(collectPayloads(rows, snapshotFromPayload));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getEvidence(
    ids: readonly EvidenceId[],
  ): Promise<Result<readonly EvidenceRecord[], StorageError>> {
    if (ids.length === 0) {
      return Promise.resolve(ok([]));
    }
    try {
      const placeholders = ids.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT payload FROM evidence WHERE id IN (${placeholders}) ORDER BY id, snapshot_id`,
        )
        .all(...ids) as PayloadRow[];
      return Promise.resolve(collectPayloads(rows, evidenceFromPayload));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getFileHashes(
    snapshotId: RepositorySnapshotId,
  ): Promise<Result<Readonly<Record<string, string>>, StorageError>> {
    try {
      const rows = this.db
        .prepare('SELECT file_path, content_hash FROM file_hashes WHERE snapshot_id = ?')
        .all(snapshotId) as { file_path: string; content_hash: string }[];
      const hashes: Record<string, string> = {};
      for (const row of rows) {
        hashes[row.file_path] = row.content_hash;
      }
      return Promise.resolve(ok(hashes));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getCurrentSnapshotId(): Promise<Result<RepositorySnapshotId | undefined, StorageError>> {
    try {
      const row = this.db
        .prepare("SELECT value FROM index_state WHERE key = 'currentSnapshotId'")
        .get() as { value: string } | undefined;
      return Promise.resolve(ok(row?.value as RepositorySnapshotId | undefined));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public cacheFragments(
    entries: readonly FragmentCacheEntry[],
  ): Promise<Result<void, StorageError>> {
    try {
      const statement = this.db.prepare(UPSERTS.fragment);
      this.db.transaction(() => {
        for (const entry of entries) {
          statement.run({
            file_path: entry.filePath,
            content_hash: entry.contentHash,
            payload: entry.payload,
          });
        }
      })();
      return Promise.resolve(ok(undefined));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getCachedFragments(
    requests: readonly Pick<FragmentCacheEntry, 'filePath' | 'contentHash'>[],
  ): Promise<Result<Readonly<Record<string, string>>, StorageError>> {
    try {
      const statement = this.db.prepare(
        'SELECT payload FROM fragment_cache WHERE file_path = ? AND content_hash = ?',
      );
      const found: Record<string, string> = {};
      for (const request of requests) {
        const row = statement.get(request.filePath, request.contentHash) as
          { payload: string } | undefined;
        if (row !== undefined) {
          found[request.filePath] = row.payload;
        }
      }
      return Promise.resolve(ok(found));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public saveRunRecord(record: IndexRunRecord): Promise<Result<void, StorageError>> {
    try {
      this.db.prepare(UPSERTS.state).run({ key: 'lastRun', value: JSON.stringify(record) });
      return Promise.resolve(ok(undefined));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public getRunRecord(): Promise<Result<IndexRunRecord | undefined, StorageError>> {
    try {
      const row = this.db.prepare("SELECT value FROM index_state WHERE key = 'lastRun'").get() as
        { value: string } | undefined;
      if (row === undefined) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(ok(JSON.parse(row.value) as IndexRunRecord));
    } catch (error) {
      return Promise.resolve(err(toStorageError(error)));
    }
  }

  public close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
