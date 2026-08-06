import { cliIndexOutputSchema } from '@impactgraph/contracts';
import { isWorkspaceInitialized } from '@impactgraph/persistence';
import { indexWarnings, performIndexRun, snapshotSummary } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { IndexProgress } from '@impactgraph/application';
import type { IndexRunOutcome } from '@impactgraph/workspace-engine';

/** Story 2.6: live progress on a TTY (overwritten line), silence when piped or in JSON mode. */
const ttyProgress = (context: CommandContext): ((progress: IndexProgress) => void) | undefined => {
  if (context.format === 'json' || !process.stderr.isTTY) {
    return undefined;
  }
  return (progress) => {
    const counts =
      progress.totalFiles > 0
        ? ` ${String(progress.filesProcessed)}/${String(progress.totalFiles)} files`
        : '';
    process.stderr.write(`\r[2Kindexing: ${progress.phase}${counts}`);
    if (progress.phase === 'persisting') {
      process.stderr.write('\n');
    }
  };
};

export const runIndex = async (context: CommandContext): Promise<CommandResult> => {
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  const onProgress = ttyProgress(context);
  const indexed = await performIndexRun(
    context.rootDir,
    onProgress === undefined ? {} : { onProgress },
  );
  if (!indexed.ok) {
    return failed(indexed.failure);
  }
  const warnings = indexWarnings(indexed.value.summary);
  render(context, indexed.value, warnings);
  return succeeded(warnings.length > 0);
};

const render = (
  context: CommandContext,
  outcome: IndexRunOutcome,
  warnings: readonly string[],
): void => {
  const { summary, snapshot, repositories } = outcome;
  if (context.format === 'json') {
    writeJson(context, cliIndexOutputSchema, {
      schemaVersion: 1,
      command: 'index',
      snapshot: snapshotSummary(snapshot),
      fileCount: summary.fileCount,
      changedFileCount: summary.changedFileCount,
      reusedFileCount: summary.reusedFileCount,
      ignoredCount: summary.ignoredCount,
      nodeCount: summary.nodeCount,
      edgeCount: summary.edgeCount,
      warnings: [...warnings],
      repositories: [...repositories],
    });
    return;
  }
  writeLines(context, [
    `Indexed ${String(summary.fileCount)} files → snapshot ${snapshot.id}`,
    `  parsed: ${String(summary.changedFileCount)}  reused: ${String(summary.reusedFileCount)}  ignored: ${String(summary.ignoredCount)}`,
    `  graph: ${String(summary.nodeCount)} nodes, ${String(summary.edgeCount)} edges`,
    ...repositories
      .filter((repo) => repo.name !== '(workspace root)')
      .map(
        (repo) =>
          `  repository: ${repo.name} — ${repo.indexed ? `${String(repo.fileCount)} files` : `not indexed (${repo.reason ?? 'unknown'})`}`,
      ),
    ...(warnings.length > 0
      ? [`  warnings (${String(warnings.length)}):`, ...warnings.map((w) => `    - ${w}`)]
      : []),
  ]);
};
