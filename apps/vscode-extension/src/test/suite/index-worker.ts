import { join } from 'node:path';

import { createRepositorySnapshot, serializeRepositorySnapshot } from '@impactgraph/domain';
import { createGitCliAdapter } from '@impactgraph/git';
import { indexDatabasePath } from '@impactgraph/persistence';
import { startIndexWorker } from '@impactgraph/repository-intelligence';

import { requireExtension } from './support.js';

import type { IndexRunnerHandle, WorkerIndexRequest } from '@impactgraph/repository-intelligence';

// Shared access to the bundled index worker: the cancellation suite drives it directly, and
// `ensureIndexed` re-runs it to explain *why* `Reindex Workspace` produced nothing (the command
// reports worker failures to the OutputChannel, which no API can read back).

export const indexWorkerEntry = (): string =>
  join(requireExtension().extensionPath, 'dist', 'index-worker.cjs');

/** The same request `runReindex` builds, rebuilt here so the worker sees identical input. */
export const buildIndexRequest = async (root: string, id: string): Promise<WorkerIndexRequest> => {
  const status = await createGitCliAdapter().readRepositoryStatus(root);
  if (!status.ok) {
    throw new Error(`git status failed: ${status.error.message}`);
  }
  const createdAt = new Date().toISOString();
  const snapshot = createRepositorySnapshot({
    id,
    repositoryIdentity: status.value.repositoryIdentity,
    head: status.value.head,
    dirtyWorkingTree: status.value.dirtyWorkingTree,
    indexVersion: 1,
    createdAt,
  });
  if (!snapshot.ok) {
    throw new Error('the repository state failed snapshot validation');
  }
  return {
    rootDir: root,
    dbPath: indexDatabasePath(root),
    snapshot: serializeRepositorySnapshot(snapshot.value),
    analysisRunId: `run-${id}`,
    createdAt,
    ignoreGlobs: [],
    disabledFrameworks: [],
    incremental: true,
  };
};

export const startIndexRun = async (root: string, id: string): Promise<IndexRunnerHandle> =>
  startIndexWorker(await buildIndexRequest(root, id), {
    entryPath: indexWorkerEntry(),
    onProgress: () => undefined,
  });

/**
 * The two things that make a forked worker silently do nothing inside an extension host: the
 * child is not launched as Node (VS Code strips ELECTRON_RUN_AS_NODE from the extension
 * environment, so `fork` starts the Electron helper as a GUI app), or a native module cannot be
 * resolved/loaded. Both are reported, because neither produces output on its own.
 */
const forkEnvironment = (): string =>
  `execPath=${process.execPath}, ELECTRON_RUN_AS_NODE=${process.env['ELECTRON_RUN_AS_NODE'] ?? '<unset>'}`;

const raceOutcome = async <T>(outcome: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([outcome, new Promise<'timeout'>((resolve) => setTimeout(resolve, ms, 'timeout'))]);

/** Human-readable reason an index run does not produce an index, for failure messages. */
export const diagnoseIndexWorker = async (root: string): Promise<string> => {
  const environment = forkEnvironment();
  try {
    const handle = await startIndexRun(root, `snap-diagnose-${Date.now().toString(36)}`);
    const outcome = await raceOutcome(handle.outcome, 20_000);
    handle.cancel();
    if (outcome === 'timeout') {
      return `a direct index run never answered within 20 s (${environment})`;
    }
    return outcome.kind === 'done'
      ? `a direct index run succeeded, so the failure is in the command wiring (${environment})`
      : `a direct index run ended as '${outcome.kind}': ${outcome.message} (${environment})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return `a direct index run could not even start: ${message} (${environment})`;
  }
};
