import type {
  EvidenceId,
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  RepositorySnapshot,
  RepositorySnapshotId,
  Result,
} from '@impactgraph/domain';

export type StorageErrorCode = 'io' | 'corruption' | 'validation' | 'migration';

export interface StorageError {
  readonly name: 'StorageError';
  readonly code: StorageErrorCode;
  readonly message: string;
}

export const storageError = (code: StorageErrorCode, message: string): StorageError =>
  Object.freeze({ name: 'StorageError' as const, code, message });

export interface FileHash {
  readonly filePath: string;
  readonly contentHash: string;
}

/** A cached, snapshot-neutral parse result keyed by file path + content hash (PRD §32). */
export interface FragmentCacheEntry {
  readonly filePath: string;
  readonly contentHash: string;
  readonly payload: string;
}

/**
 * One atomic index write: everything persists or nothing does (PRD §34). When `markCurrent`
 * is set, the "current snapshot" pointer moves in the same transaction — the swap happens
 * only on success, so a failed re-index never dethrones the previous valid index.
 */
export interface GraphIndexUpdate {
  readonly snapshot: RepositorySnapshot;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly EvidenceRecord[];
  readonly fileHashes?: readonly FileHash[];
  readonly markCurrent?: boolean;
}

export interface StoredGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * Persistence port for the repository index (ADR-0006: SQLite behind this abstraction).
 * The index is a disposable cache — rebuildable, never the system of record. No raw SQL or
 * storage paths may appear above the adapter (PRD §28.3).
 */
export interface IndexStorePort {
  /** Atomically persist a snapshot with its graph records. Batch upsert semantics. */
  applyIndexUpdate(update: GraphIndexUpdate): Promise<Result<void, StorageError>>;
  /** Load all nodes and edges recorded for a snapshot. */
  loadGraph(snapshotId: RepositorySnapshotId): Promise<Result<StoredGraph, StorageError>>;
  getSnapshot(
    id: RepositorySnapshotId,
  ): Promise<Result<RepositorySnapshot | undefined, StorageError>>;
  /** All snapshots, newest first by createdAt then id (deterministic). */
  listSnapshots(): Promise<Result<readonly RepositorySnapshot[], StorageError>>;
  getEvidence(ids: readonly EvidenceId[]): Promise<Result<readonly EvidenceRecord[], StorageError>>;
  /** Content hashes recorded with a snapshot — the incremental-indexing currency (PRD §32). */
  getFileHashes(
    snapshotId: RepositorySnapshotId,
  ): Promise<Result<Readonly<Record<string, string>>, StorageError>>;
  /** The last successfully completed index generation, if any. */
  getCurrentSnapshotId(): Promise<Result<RepositorySnapshotId | undefined, StorageError>>;
  /** Persist parse results immediately — partial progress survives a failed run (PRD §32). */
  cacheFragments(entries: readonly FragmentCacheEntry[]): Promise<Result<void, StorageError>>;
  /** Cached payloads for (path, hash) pairs; misses are simply absent from the result. */
  getCachedFragments(
    requests: readonly Pick<FragmentCacheEntry, 'filePath' | 'contentHash'>[],
  ): Promise<Result<Readonly<Record<string, string>>, StorageError>>;
  /** Last successful run's status record — feeds `impactgraph status` (PRD §32, Story 2.6). */
  saveRunRecord(record: IndexRunRecord): Promise<Result<void, StorageError>>;
  getRunRecord(): Promise<Result<IndexRunRecord | undefined, StorageError>>;
  close(): Promise<void>;
}

export interface IndexRunRecord {
  readonly snapshotId: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly fileCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly warningCount: number;
  /** First warnings only (capped) — full detail lives in the run's own output. */
  readonly warnings: readonly string[];
  /**
   * Files the scanner excluded (ignore globs, .gitignore, secret exclusions). Additive and optional:
   * a record written before this field existed reports nothing rather than 0, which would assert that
   * nothing was excluded (item 10).
   */
  readonly ignoredCount?: number;
}
