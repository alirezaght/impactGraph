import { isWorkspaceInitialized } from '@impactgraph/persistence';
import { buildExportBundle } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';

import { renderExport } from './export-render.js';

import type { CommandContext, CommandResult } from '../context.js';

// Story 10.2 / 4.4 — `impactgraph export [analysisId]`: the §22 implementation context for
// coding agents, as JSON (schema-validated), §38.1 Markdown, or a text summary.

export const runExport = async (context: CommandContext): Promise<CommandResult> => {
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  const bundle = await buildExportBundle(context.rootDir, context.args[0]);
  if (!bundle.ok) {
    return failed(bundle.error);
  }
  renderExport(context, bundle.value);
  return succeeded();
};
