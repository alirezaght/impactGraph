import { cliConfigOutputSchema, DEFAULT_WORKSPACE_CONFIG } from '@impactgraph/contracts';
import { isWorkspaceInitialized, readWorkspaceConfig } from '@impactgraph/persistence';
import {
  configDiff,
  configHistory,
  detectConfigDrift,
  restoreConfigVersion,
  rollbackConfigChange,
} from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';

/** `config history` — the §Z12 audit trail; entries are contract-validated on read. */
const runHistory = (context: CommandContext): CommandResult => {
  const history = configHistory(context.rootDir);
  if (!history.ok) {
    return failed(history.error);
  }
  if (context.format === 'json') {
    context.write(JSON.stringify({ schemaVersion: 1, entries: history.value }, null, 2));
    return succeeded();
  }
  writeLines(
    context,
    history.value.length === 0
      ? ['no configuration changes recorded']
      : history.value.map(
          (entry) =>
            `${entry.timestamp}  ${entry.rollbackId}  [${entry.classification}/${entry.approval}] ${entry.file}: ${entry.reason}${entry.rollbackOf === undefined ? '' : ` (rollback of ${entry.rollbackOf})`}`,
        ),
  );
  return succeeded();
};

/** `config rollback [rollbackId]` — §Z14: restore by APPENDING; the trail is never rewritten. */
const runRollback = (context: CommandContext): CommandResult => {
  const rolled = rollbackConfigChange({
    rootDir: context.rootDir,
    rollbackId: context.args[1],
    actor: { kind: 'user' },
  });
  if (!rolled.ok) {
    return failed(rolled.error);
  }
  context.write(
    `Rolled back ${rolled.value.rollbackOf ?? '?'} — ${rolled.value.file} restored (new entry ${rolled.value.rollbackId}).`,
  );
  return succeeded();
};

/** `config drift` — §Z10 reconciliation of committed config against the current graph. */
const runDrift = async (context: CommandContext): Promise<CommandResult> => {
  const drift = await detectConfigDrift(context.rootDir);
  if (!drift.ok) {
    return failed(drift.error);
  }
  if (context.format === 'json') {
    context.write(JSON.stringify({ schemaVersion: 1, ...drift.value }, null, 2));
    return succeeded(drift.value.needsReview.length > 0);
  }
  const lines = [
    ...drift.value.needsReview.map(
      (item) => `needs-review [${item.kind}] ${item.subject}: ${item.detail}`,
    ),
    ...drift.value.suggestions.map(
      (item) => `suggestion  [${item.kind}] ${item.subject}: ${item.detail}`,
    ),
  ];
  writeLines(context, lines.length === 0 ? ['configuration matches the current graph'] : lines);
  return succeeded(drift.value.needsReview.length > 0);
};

/** `config diff [id]` — what one audited change did, as flat path lines (§Z14). */
const runDiffSubcommand = (context: CommandContext): CommandResult => {
  const diff = configDiff(context.rootDir, context.args[1]);
  if (!diff.ok) {
    return failed(diff.error);
  }
  writeLines(context, [
    `${diff.value.entry.rollbackId}  ${diff.value.entry.file}: ${diff.value.entry.reason}`,
    ...diff.value.lines.map(
      (line) =>
        `  ${line.path}: ${JSON.stringify(line.before) ?? 'undefined'} → ${JSON.stringify(line.after) ?? 'undefined'}`,
    ),
  ]);
  return succeeded();
};

/** `config restore <id>` — re-apply the state after a chosen entry, by append (§Z14). */
const runRestore = (context: CommandContext): CommandResult => {
  const id = context.args[1];
  if (id === undefined) {
    return failed({
      category: 'configurationError',
      message: 'usage: impactgraph config restore <rollbackId>',
    });
  }
  const restored = restoreConfigVersion(context.rootDir, id, { kind: 'user' });
  if (!restored.ok) {
    return failed(restored.error);
  }
  context.write(
    `Restored ${restored.value.file} to the state after ${id} (new entry ${restored.value.rollbackId}).`,
  );
  return succeeded();
};

const SUBCOMMANDS: Readonly<
  Record<string, (context: CommandContext) => CommandResult | Promise<CommandResult>>
> = {
  history: runHistory,
  diff: runDiffSubcommand,
  restore: runRestore,
  rollback: runRollback,
  drift: runDrift,
};

export const runConfig = (context: CommandContext): CommandResult | Promise<CommandResult> => {
  const subcommand = context.args[0] === undefined ? undefined : SUBCOMMANDS[context.args[0]];
  if (subcommand !== undefined) {
    return subcommand(context);
  }
  const read = readWorkspaceConfig(context.rootDir);
  if (!read.ok) {
    return failed({ category: 'configurationError', message: read.error.message });
  }
  const initialized = isWorkspaceInitialized(context.rootDir);
  const config = read.value ?? DEFAULT_WORKSPACE_CONFIG;
  if (context.format === 'json') {
    writeJson(context, cliConfigOutputSchema, {
      schemaVersion: 1,
      command: 'config',
      initialized,
      config,
    });
  } else {
    writeLines(context, [
      initialized ? 'Workspace config (.impactgraph/config.yml):' : 'Defaults (not initialized):',
      `  schemaVersion: ${String(config.schemaVersion)}`,
      `  ignore: ${config.ignore === undefined ? '(none)' : config.ignore.join(', ')}`,
    ]);
  }
  return succeeded();
};
