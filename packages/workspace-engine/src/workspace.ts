import { existsSync } from 'node:fs';

import { categorizeIndexWarnings } from '@impactgraph/domain';
import {
  ensureWorkspaceScaffold,
  indexDatabasePath,
  isWorkspaceInitialized,
  openSqliteIndexStore,
  scaffoldProjectKnowledgeFiles,
} from '@impactgraph/persistence';

import { failWith } from './failure.js';
import { assessWorkspaceFreshness, parseWarningLine } from './freshness.js';
import { toIndexFreshnessDto, toIndexWarningReportDto } from './reports/index-health-dto.js';
import { snapshotSummary } from './snapshot.js';

import type { Failable } from './failure.js';
import type { IndexRunRecord, IndexStorePort } from '@impactgraph/application';
import type { IndexFreshnessDto, IndexWarningReportDto } from '@impactgraph/contracts';

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
  /** Read-time index freshness (item 9): the status surface states staleness itself. */
  readonly freshness?: IndexFreshnessDto | undefined;
  /** The last run's warnings, categorized — the same report shape analyze uses. */
  readonly indexWarnings?: IndexWarningReportDto | undefined;
  /** Files the last run deliberately excluded; absent when the run predates the counter. */
  readonly ignoredCount?: number | undefined;
}

/**
 * The last run's operational blocks: the run summary line, the categorized warning report built
 * over the TRUE warning count (the persisted lines are a capped sample and say so), and the
 * ignored-file count. No predicted area here — status describes the repository, not an analysis.
 */
const runBlocks = (
  run: IndexRunRecord | undefined,
): Pick<WorkspaceStatus, 'lastRun' | 'indexWarnings' | 'ignoredCount'> => {
  if (run === undefined) {
    return {};
  }
  const report = categorizeIndexWarnings(run.warnings.map(parseWarningLine), new Set(), {
    totalWarningCount: run.warningCount,
    ...(run.ignoredCount === undefined ? {} : { ignoredFileCount: run.ignoredCount }),
  });
  return {
    lastRun: {
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      warningCount: run.warningCount,
    },
    indexWarnings: toIndexWarningReportDto(report),
    ...(run.ignoredCount === undefined ? {} : { ignoredCount: run.ignoredCount }),
  };
};

const gatherIndexedStatus = async (
  store: IndexStorePort,
  initialized: boolean,
): Promise<Failable<WorkspaceStatus | undefined>> => {
  const current = await store.getCurrentSnapshotId();
  if (!current.ok || current.value === undefined) {
    return { ok: true, value: undefined };
  }
  const snapshot = await store.getSnapshot(current.value);
  const graph = await store.loadGraph(current.value);
  const hashes = await store.getFileHashes(current.value);
  if (!snapshot.ok || snapshot.value === undefined || !graph.ok || !hashes.ok) {
    return failWith('indexingFailure', 'index store is unreadable — re-run `impactgraph index`');
  }
  const run = await store.getRunRecord();
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
      ...runBlocks(run.ok ? run.value : undefined),
    },
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
  let gathered: Failable<WorkspaceStatus | undefined>;
  try {
    gathered = await gatherIndexedStatus(store.value, initialized);
  } finally {
    await store.value.close();
  }
  if (!gathered.ok) {
    return gathered;
  }
  if (gathered.value === undefined) {
    return { ok: true, value: notIndexed };
  }
  // Derived at answer time, never persisted (item 10). Git being unavailable does not fail the
  // status: the assessment simply reports what it could verify.
  const freshness = await assessWorkspaceFreshness({ rootDir });
  return { ok: true, value: { ...gathered.value, freshness: toIndexFreshnessDto(freshness) } };
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
