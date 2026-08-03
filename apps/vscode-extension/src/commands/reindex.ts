import { join } from 'node:path';

import { createRepositorySnapshot, serializeRepositorySnapshot } from '@impactgraph/domain';
import { createGitCliAdapter } from '@impactgraph/git';
import { indexDatabasePath, readWorkspaceConfig } from '@impactgraph/persistence';
import { startIndexWorker } from '@impactgraph/repository-intelligence';
import * as vscode from 'vscode';

import { requireTrustedWorkspace } from '../workspace.js';

import type { WorkerIndexRequest } from '@impactgraph/repository-intelligence';

// Story 7.2: indexing runs in the bundled worker process; the shell only forwards progress
// and cancellation (PRD §32/§33). Cancellation reaches the worker as a protocol message.

const buildRequest = async (root: string): Promise<WorkerIndexRequest | string> => {
  const config = readWorkspaceConfig(root);
  if (!config.ok) {
    return config.error.message;
  }
  const git = createGitCliAdapter();
  const status = await git.readRepositoryStatus(root);
  if (!status.ok) {
    return status.error.message;
  }
  const now = new Date().toISOString();
  const snapshot = createRepositorySnapshot({
    id: status.value.dirtyWorkingTree
      ? `snap-${status.value.head.commitSha.slice(0, 12)}-dirty-${Date.now().toString(36)}`
      : `snap-${status.value.head.commitSha.slice(0, 12)}`,
    repositoryIdentity: status.value.repositoryIdentity,
    head: status.value.head,
    dirtyWorkingTree: status.value.dirtyWorkingTree,
    indexVersion: 1,
    createdAt: now,
  });
  if (!snapshot.ok) {
    return 'repository state failed validation';
  }
  return {
    rootDir: root,
    dbPath: indexDatabasePath(root),
    snapshot: serializeRepositorySnapshot(snapshot.value),
    analysisRunId: `run-${snapshot.value.id}`,
    createdAt: now,
    ignoreGlobs: config.value?.ignore ?? [],
    disabledFrameworks: config.value?.disabledFrameworks ?? [],
    incremental: true,
  };
};

export const runReindex = async (
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const request = await buildRequest(root);
  if (typeof request === 'string') {
    void vscode.window.showErrorMessage(`ImpactGraph: cannot index — ${request}`);
    return;
  }
  const workerEntry = join(context.extensionPath, 'dist', 'index-worker.cjs');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ImpactGraph: indexing workspace',
      cancellable: true,
    },
    async (progress, token) => {
      const handle = startIndexWorker(request, {
        entryPath: workerEntry,
        onProgress: (update) => {
          progress.report({
            message: `${update.phase} ${String(update.filesProcessed)}/${String(update.totalFiles)}`,
          });
        },
      });
      token.onCancellationRequested(() => {
        handle.cancel();
      });
      const outcome = await handle.outcome;
      if (outcome.kind === 'done') {
        output.appendLine(
          `[index] snapshot ${request.snapshot.id}: ${String(outcome.summary.nodeCount)} nodes, ${String(outcome.summary.edgeCount)} edges, ${String(outcome.summary.parseWarnings.length)} warnings`,
        );
        void vscode.window.showInformationMessage(
          `ImpactGraph: indexed ${String(outcome.summary.fileCount)} files (${String(outcome.summary.nodeCount)} nodes).`,
        );
      } else if (outcome.kind === 'cancelled') {
        void vscode.window.showInformationMessage(
          'ImpactGraph: indexing cancelled — previous index remains valid.',
        );
      } else {
        output.appendLine(`[index] error: ${outcome.message}`);
        void vscode.window.showErrorMessage(
          'ImpactGraph: indexing failed. See the ImpactGraph output channel.',
        );
      }
    },
  );
};
