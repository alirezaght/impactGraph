import {
  collectWorkspaceRepositoryContext,
  collectWorkspaceStatus,
  indexWarnings,
  initializeWorkspace,
  performIndexRun,
  requireInitialized,
  snapshotSummary,
} from '@impactgraph/workspace-engine';

import { readOwnVersion, SERVER_NAME } from './version.js';

import type { ToolHandler } from './handler-types.js';

// Workspace lifecycle tools — steps 1–2 of the coverage-first workflow: validate coverage
// (status reports every registered repository's derived index state plus unregistered
// candidates), then index the root and every registered repository into one graph.

const initialize: ToolHandler<'initialize_workspace'> = (rootDir) => {
  const outcome = initializeWorkspace(rootDir);
  return Promise.resolve(
    outcome.ok
      ? {
          ok: true,
          value: {
            created: [...outcome.value.created],
            alreadyInitialized: outcome.value.alreadyInitialized,
          },
        }
      : outcome,
  );
};

const workspaceStatus: ToolHandler<'get_workspace_status'> = async (rootDir) => {
  const status = await collectWorkspaceStatus(rootDir);
  if (!status.ok) {
    return status;
  }
  // Repository coverage is part of the status: step 1 of the workflow is validating it.
  const context = await collectWorkspaceRepositoryContext(rootDir);
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      command: 'status',
      ...status.value,
      ...(context.ok
        ? {
            repositories: [...context.value.repositories],
            candidateRepositories: [...context.value.candidates],
            // Roster limitations were computed and then dropped here (item 9, GAP 2) — what the
            // analysis does NOT cover is part of the workspace's operational state.
            limitations: [...context.value.limitations],
          }
        : {}),
      // Which build produced this answer (item 9, GAP 5). Version only — never an invented hash.
      server: { name: SERVER_NAME, version: readOwnVersion() },
    },
  };
};

const indexWorkspace: ToolHandler<'index_workspace'> = async (rootDir) => {
  const initialized = requireInitialized(rootDir);
  if (!initialized.ok) {
    return initialized;
  }
  const indexed = await performIndexRun(rootDir);
  if (!indexed.ok) {
    return { ok: false, error: indexed.failure };
  }
  const { summary, snapshot } = indexed.value;
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      command: 'index',
      snapshot: snapshotSummary(snapshot),
      fileCount: summary.fileCount,
      changedFileCount: summary.changedFileCount,
      reusedFileCount: summary.reusedFileCount,
      ignoredCount: summary.ignoredCount,
      nodeCount: summary.nodeCount,
      edgeCount: summary.edgeCount,
      warnings: indexWarnings(summary),
      repositories: [...indexed.value.repositories],
    },
  };
};

export const WORKSPACE_HANDLERS = {
  initialize_workspace: initialize,
  get_workspace_status: workspaceStatus,
  index_workspace: indexWorkspace,
} as const;
