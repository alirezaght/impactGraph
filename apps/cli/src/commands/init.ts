import { cliInitOutputSchema } from '@impactgraph/contracts';
import { initializeWorkspace } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';

export const runInit = (context: CommandContext): CommandResult => {
  const scaffold = initializeWorkspace(context.rootDir);
  if (!scaffold.ok) {
    return failed(scaffold.error);
  }
  const { created, alreadyInitialized } = scaffold.value;
  if (context.format === 'json') {
    writeJson(context, cliInitOutputSchema, {
      schemaVersion: 1,
      command: 'init',
      created: [...created],
      alreadyInitialized,
    });
  } else {
    writeLines(
      context,
      alreadyInitialized && created.length === 0
        ? ['Workspace already initialized (.impactgraph/ present).']
        : created.map((file) => `created ${file}`),
    );
  }
  return succeeded();
};
