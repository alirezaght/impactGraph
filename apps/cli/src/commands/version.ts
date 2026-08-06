import { cliVersionOutputSchema } from '@impactgraph/contracts';

import { succeeded } from '../context.js';
import { writeJson } from '../output.js';
import { CLI_NAME, readOwnVersion } from '../version.js';

import type { CommandContext, CommandResult } from '../context.js';

/**
 * `impactgraph version` / `--version` (dogfooding item 9): which build produced the answer.
 * A user or agent debugging a stale or divergent analysis must be able to name the build.
 */
export const runVersion = (context: CommandContext): CommandResult => {
  if (context.format === 'json') {
    writeJson(context, cliVersionOutputSchema, {
      schemaVersion: 1,
      command: 'version',
      name: CLI_NAME,
      version: readOwnVersion(),
    });
  } else {
    context.write(`${CLI_NAME} ${readOwnVersion()}`);
  }
  return succeeded();
};
