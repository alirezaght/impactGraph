import { cliApproveOutputSchema } from '@impactgraph/contracts';
import { isWorkspaceInitialized } from '@impactgraph/persistence';
import { approveAnalysis } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';

// Story 11.4 — `impactgraph approve <analysisId>`: freezes an analysis as the review baseline.
// Approval is a status transition; the store enforces that nothing else changed (§40.3).

export const runApprove = async (context: CommandContext): Promise<CommandResult> => {
  const analysisId = context.args[0];
  if (analysisId === undefined) {
    return failed({
      category: 'configurationError',
      message: 'usage: impactgraph approve <analysisId>',
    });
  }
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  const approved = await approveAnalysis(context.rootDir, analysisId);
  if (!approved.ok) {
    return failed(approved.error);
  }
  if (context.format === 'json') {
    writeJson(context, cliApproveOutputSchema, {
      schemaVersion: 1,
      command: 'approve',
      analysisId,
      status: 'approved',
    });
  } else {
    context.write(`Approved analysis ${analysisId} — it is now the frozen review baseline.`);
  }
  return succeeded();
};
