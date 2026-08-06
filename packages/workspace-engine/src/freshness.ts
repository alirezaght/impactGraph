import { existsSync } from 'node:fs';

import { assessFreshness, categorizeWarningMessage } from '@impactgraph/domain';
import { createGitCliAdapter } from '@impactgraph/git';
import {
  artifactsPath,
  createSpecificationArtifactStore,
  indexDatabasePath,
  openSqliteIndexStore,
} from '@impactgraph/persistence';

import type { IndexRunRecord } from '@impactgraph/application';
import type {
  IndexFreshness,
  RawIndexWarning,
  RepositorySnapshot,
  RepositorySnapshotId,
} from '@impactgraph/domain';

/**
 * Read-time freshness and categorized warnings (item 10).
 *
 * Both are DERIVED on every read and never stored. A persisted "fresh" flag is stale the moment the
 * next commit lands, and the trials' complaint — staleness recorded but not warned about — is
 * exactly what happens when a flag is written once and trusted afterwards.
 */

export interface FreshnessQuery {
  readonly rootDir: string;
  /** The snapshot the analysis is bound to. Absent → the current index snapshot is used. */
  readonly snapshotId?: string | undefined;
  readonly specificationId?: string | undefined;
  readonly specificationVersion?: number | undefined;
}

const loadSnapshot = async (
  rootDir: string,
  snapshotId: string | undefined,
): Promise<RepositorySnapshot | undefined> => {
  const dbPath = indexDatabasePath(rootDir);
  if (!existsSync(dbPath)) {
    return undefined;
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return undefined;
  }
  try {
    let resolved = snapshotId;
    if (resolved === undefined) {
      const current = await store.value.getCurrentSnapshotId();
      resolved = current.ok ? current.value : undefined;
    }
    if (resolved === undefined) {
      return undefined;
    }
    const snapshot = await store.value.getSnapshot(resolved as RepositorySnapshotId);
    return snapshot.ok ? snapshot.value : undefined;
  } finally {
    await store.value.close();
  }
};

const latestSpecificationVersion = async (
  rootDir: string,
  specificationId: string | undefined,
): Promise<number | undefined> => {
  if (specificationId === undefined) {
    return undefined;
  }
  const store = createSpecificationArtifactStore(artifactsPath(rootDir));
  const latest = await store.getLatest(specificationId);
  return latest.ok && latest.value !== undefined ? latest.value.version : undefined;
};

/**
 * Compare the bound index snapshot with HEAD, the working tree, the indexed timestamp, and the
 * stored specification version. Git being unavailable is not treated as "fresh": the current state
 * is left undefined and the assessment reports only what it could verify.
 */
export const assessWorkspaceFreshness = async (query: FreshnessQuery): Promise<IndexFreshness> => {
  const indexed = await loadSnapshot(query.rootDir, query.snapshotId);
  const git = createGitCliAdapter();
  const status = await git.readRepositoryStatus(query.rootDir);
  const latestVersion = await latestSpecificationVersion(query.rootDir, query.specificationId);
  return assessFreshness({
    ...(indexed === undefined ? {} : { indexed }),
    ...(status.ok
      ? {
          current: {
            commitSha: status.value.head.commitSha,
            dirtyWorkingTree: status.value.dirtyWorkingTree,
          },
        }
      : {}),
    now: new Date().toISOString(),
    ...(query.specificationVersion === undefined
      ? {}
      : { specificationVersion: query.specificationVersion }),
    ...(latestVersion === undefined ? {} : { latestSpecificationVersion: latestVersion }),
  });
};

const readRunRecord = async (rootDir: string): Promise<IndexRunRecord | undefined> => {
  const dbPath = indexDatabasePath(rootDir);
  if (!existsSync(dbPath)) {
    return undefined;
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return undefined;
  }
  try {
    const run = await store.value.getRunRecord();
    return run.ok ? run.value : undefined;
  } finally {
    await store.value.close();
  }
};

/**
 * Warnings of the last index run, parsed back into `path` + `message` and categorized.
 *
 * They are persisted as `"<path>: <message>"` strings, so the split is on the first colon that is
 * followed by a space — path separators contain no such sequence.
 */
export const lastRunWarningRecords = async (
  rootDir: string,
): Promise<readonly RawIndexWarning[]> => {
  const run = await readRunRecord(rootDir);
  return run === undefined ? [] : run.warnings.map(parseWarningLine);
};

export const parseWarningLine = (line: string): RawIndexWarning => {
  const separator = line.indexOf(': ');
  if (separator === -1) {
    return { path: '', message: line, category: categorizeWarningMessage(line) };
  }
  const message = line.slice(separator + 2);
  return {
    path: line.slice(0, separator),
    message,
    category: categorizeWarningMessage(message),
  };
};

/**
 * The scanner's ignored-file count from the last run (item 10).
 *
 * Read from the run record rather than recounted: recounting means rescanning, and the number a
 * reader needs is the one that produced the index they are querying.
 */
export const lastRunIgnoredCount = async (rootDir: string): Promise<number | undefined> => {
  const run = await readRunRecord(rootDir);
  return run?.ignoredCount;
};

export interface LastRunWarningInputs {
  /** The persisted warning lines (a capped sample), parsed and categorized. */
  readonly indexWarnings: readonly RawIndexWarning[];
  /** The run's TRUE warning count — the sample above may be shorter (item 9, GAP 3). */
  readonly totalWarningCount?: number;
  /** Absent when the run predates the counter — never a fabricated 0 (item 10). */
  readonly ignoredFileCount?: number;
}

/**
 * Everything the summary's warning report needs from the last run, in one store read and in the
 * builder's input shape — so every caller carries the true count alongside the capped sample.
 */
export const lastRunWarningInputs = async (rootDir: string): Promise<LastRunWarningInputs> => {
  const run = await readRunRecord(rootDir);
  if (run === undefined) {
    return { indexWarnings: [] };
  }
  return {
    indexWarnings: run.warnings.map(parseWarningLine),
    totalWarningCount: run.warningCount,
    ...(run.ignoredCount === undefined ? {} : { ignoredFileCount: run.ignoredCount }),
  };
};
