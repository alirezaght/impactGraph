import { cliStatusOutputSchema } from '@impactgraph/contracts';
import { collectWorkspaceStatus } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { WorkspaceStatus } from '@impactgraph/workspace-engine';

const textLines = (status: WorkspaceStatus): string[] => {
  const lines = [
    `initialized: ${status.initialized ? 'yes' : 'no'}`,
    `indexed:     ${status.indexed ? 'yes' : 'no'}`,
  ];
  if (status.snapshot !== undefined && status.counts !== undefined) {
    lines.push(
      `snapshot:    ${status.snapshot.id} (${status.snapshot.branch ?? 'detached'} @ ${status.snapshot.commitSha.slice(0, 12)}${status.snapshot.dirtyWorkingTree ? ', dirty' : ''})`,
      `graph:       ${String(status.counts.nodes)} nodes, ${String(status.counts.edges)} edges from ${String(status.counts.files)} files`,
    );
  }
  if (status.lastRun !== undefined) {
    lines.push(
      `last run:    ${status.lastRun.finishedAt} (${String(status.lastRun.durationMs)} ms, ${String(status.lastRun.warningCount)} warnings)`,
    );
  }
  return lines;
};

export const runStatus = async (context: CommandContext): Promise<CommandResult> => {
  const status = await collectWorkspaceStatus(context.rootDir);
  if (!status.ok) {
    return failed(status.error);
  }
  if (context.format === 'json') {
    writeJson(context, cliStatusOutputSchema, {
      schemaVersion: 1,
      command: 'status',
      initialized: status.value.initialized,
      indexed: status.value.indexed,
      ...(status.value.snapshot === undefined ? {} : { snapshot: status.value.snapshot }),
      ...(status.value.counts === undefined ? {} : { counts: status.value.counts }),
      ...(status.value.lastRun === undefined ? {} : { lastRun: status.value.lastRun }),
    });
    return succeeded();
  }
  writeLines(context, textLines(status.value));
  return succeeded();
};
