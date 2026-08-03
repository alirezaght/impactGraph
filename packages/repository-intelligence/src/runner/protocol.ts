import type { IndexSummary } from '../index-repository.js';
import type { IndexProgress } from '@impactgraph/application';
import type { RepositorySnapshotJson } from '@impactgraph/domain';

// Index worker message protocol v1 (Story 2.6, repository-analysis.md): typed, versioned
// messages over the child-process IPC channel. Indexing never runs in the extension host —
// the extension (and optionally the CLI) talks to the worker through these messages only.

export const INDEX_WORKER_PROTOCOL_VERSION = 1;

/** Everything the worker needs to compose its own adapters and store — plain JSON. */
export interface WorkerIndexRequest {
  readonly rootDir: string;
  readonly dbPath: string;
  readonly snapshot: RepositorySnapshotJson;
  readonly analysisRunId: string;
  readonly createdAt: string;
  readonly ignoreGlobs: readonly string[];
  readonly disabledFrameworks: readonly string[];
  readonly incremental: boolean;
}

export type ParentToWorkerMessage =
  | { readonly protocol: 1; readonly type: 'start'; readonly request: WorkerIndexRequest }
  | { readonly protocol: 1; readonly type: 'cancel' };

export type WorkerToParentMessage =
  | { readonly protocol: 1; readonly type: 'progress'; readonly progress: IndexProgress }
  | { readonly protocol: 1; readonly type: 'done'; readonly summary: IndexSummary }
  | { readonly protocol: 1; readonly type: 'cancelled'; readonly message: string }
  | { readonly protocol: 1; readonly type: 'error'; readonly message: string };

export const isParentMessage = (value: unknown): value is ParentToWorkerMessage =>
  typeof value === 'object' &&
  value !== null &&
  (value as { protocol?: unknown }).protocol === INDEX_WORKER_PROTOCOL_VERSION &&
  ['start', 'cancel'].includes(String((value as { type?: unknown }).type));

export const isWorkerMessage = (value: unknown): value is WorkerToParentMessage =>
  typeof value === 'object' &&
  value !== null &&
  (value as { protocol?: unknown }).protocol === INDEX_WORKER_PROTOCOL_VERSION &&
  ['progress', 'done', 'cancelled', 'error'].includes(String((value as { type?: unknown }).type));
