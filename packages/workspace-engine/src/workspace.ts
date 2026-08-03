import { existsSync } from 'node:fs';

import {
  ensureWorkspaceScaffold,
  indexDatabasePath,
  isWorkspaceInitialized,
  openSqliteIndexStore,
  scaffoldProjectKnowledgeFiles,
} from '@impactgraph/persistence';

import { failWith } from './failure.js';
import { snapshotSummary } from './snapshot.js';

import type { Failable } from './failure.js';
import type { IndexStorePort } from '@impactgraph/application';

export interface WorkspaceScaffoldOutcome {
  readonly created: readonly string[];
  readonly alreadyInitialized: boolean;
}

/** `initialize_workspace` / `impactgraph init` — §16 layout, idempotent. */
export const initializeWorkspace = (rootDir: string): Failable<WorkspaceScaffoldOutcome> => {
  const scaffold = ensureWorkspaceScaffold(rootDir);
  if (!scaffold.ok) {
    return failWith('configurationError', scaffold.error.message);
  }
  const knowledge = scaffoldProjectKnowledgeFiles(rootDir);
  if (!knowledge.ok) {
    return failWith('configurationError', knowledge.error.message);
  }
  return {
    ok: true,
    value: {
      created: [...scaffold.value.created, ...knowledge.value],
      alreadyInitialized: scaffold.value.alreadyInitialized,
    },
  };
};

export const requireInitialized = (rootDir: string): Failable<void> =>
  isWorkspaceInitialized(rootDir)
    ? { ok: true, value: undefined }
    : failWith('configurationError', 'workspace not initialized — run `impactgraph init` first');

export interface WorkspaceStatus {
  readonly initialized: boolean;
  readonly indexed: boolean;
  readonly snapshot?: ReturnType<typeof snapshotSummary> | undefined;
  readonly counts?: { files: number; nodes: number; edges: number } | undefined;
  readonly lastRun?: { finishedAt: string; durationMs: number; warningCount: number } | undefined;
}

const readLastRun = async (store: IndexStorePort): Promise<WorkspaceStatus['lastRun']> => {
  const run = await store.getRunRecord();
  if (!run.ok || run.value === undefined) {
    return undefined;
  }
  return {
    finishedAt: run.value.finishedAt,
    durationMs: run.value.durationMs,
    warningCount: run.value.warningCount,
  };
};

/** `get_workspace_status` / `impactgraph status` — the current index generation. */
export const collectWorkspaceStatus = async (
  rootDir: string,
): Promise<Failable<WorkspaceStatus>> => {
  const initialized = isWorkspaceInitialized(rootDir);
  const notIndexed: WorkspaceStatus = { initialized, indexed: false };
  const dbPath = indexDatabasePath(rootDir);
  if (!existsSync(dbPath)) {
    return { ok: true, value: notIndexed };
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return failWith('indexingFailure', store.error.message);
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    if (!current.ok || current.value === undefined) {
      return { ok: true, value: notIndexed };
    }
    const snapshot = await store.value.getSnapshot(current.value);
    const graph = await store.value.loadGraph(current.value);
    const hashes = await store.value.getFileHashes(current.value);
    if (!snapshot.ok || snapshot.value === undefined || !graph.ok || !hashes.ok) {
      return failWith('indexingFailure', 'index store is unreadable — re-run `impactgraph index`');
    }
    const lastRun = await readLastRun(store.value);
    return {
      ok: true,
      value: {
        initialized,
        indexed: true,
        snapshot: snapshotSummary(snapshot.value),
        counts: {
          files: Object.keys(hashes.value).length,
          nodes: graph.value.nodes.length,
          edges: graph.value.edges.length,
        },
        ...(lastRun === undefined ? {} : { lastRun }),
      },
    };
  } finally {
    await store.value.close();
  }
};

/** Warnings of the most recent index run (capped at write time) — Issues-view material. */
export const readLastRunWarnings = async (rootDir: string): Promise<Failable<string[]>> => {
  const dbPath = indexDatabasePath(rootDir);
  if (!existsSync(dbPath)) {
    return { ok: true, value: [] };
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return failWith('indexingFailure', store.error.message);
  }
  try {
    const run = await store.value.getRunRecord();
    return { ok: true, value: run.ok && run.value !== undefined ? [...run.value.warnings] : [] };
  } finally {
    await store.value.close();
  }
};
