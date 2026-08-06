import { cliStatusOutputSchema } from '@impactgraph/contracts';
import {
  collectWorkspaceRepositoryContext,
  collectWorkspaceStatus,
} from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';
import { CLI_NAME, readOwnVersion } from '../version.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { WorkspaceRepositoryContext, WorkspaceStatus } from '@impactgraph/workspace-engine';

const repositoryLines = (repos?: WorkspaceRepositoryContext): string[] => [
  ...(repos?.repositories ?? []).map(
    (repo) =>
      `repository:  ${repo.name} — ${repo.indexed ? `indexed (${String(repo.fileCount)} files)` : `not indexed (${repo.reason ?? 'unknown'})`}`,
  ),
  ...(repos?.candidates ?? []).map(
    (candidate) => `candidate:   ${candidate.path} — ${candidate.hint}`,
  ),
];

/** Item 9: freshness, categorized warnings and ignored source, stated by the tool itself. */
const healthLines = (status: WorkspaceStatus): string[] => {
  const lines: string[] = [];
  if (status.freshness !== undefined) {
    lines.push(
      `freshness:   ${status.freshness.state}${status.freshness.stale ? ' (stale)' : ''}${status.freshness.reasons.length > 0 ? ` — ${status.freshness.reasons.join(' ')}` : ''}`,
    );
  }
  if (status.indexWarnings !== undefined && status.indexWarnings.groups.length > 0) {
    const groups = status.indexWarnings.groups
      .map((group) => `${String(group.count)} ${group.category}`)
      .join(', ');
    const sampled =
      status.indexWarnings.sampled === true
        ? ` — categories cover a sample; ${String(status.indexWarnings.omittedWarningCount ?? 0)} warnings not shown`
        : '';
    lines.push(
      `warnings:    ${String(status.indexWarnings.totalCount)} total (${groups})${sampled}`,
    );
  }
  if (status.ignoredCount !== undefined) {
    lines.push(`ignored:     ${String(status.ignoredCount)} files excluded from indexing`);
  }
  return lines;
};

const textLines = (status: WorkspaceStatus, repos?: WorkspaceRepositoryContext): string[] => {
  const lines = [
    `${CLI_NAME}: ${readOwnVersion()}`,
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
  return [
    ...lines,
    ...healthLines(status),
    ...repositoryLines(repos),
    ...(repos?.limitations ?? []).map((limitation) => `limitation:  ${limitation}`),
  ];
};

export const runStatus = async (context: CommandContext): Promise<CommandResult> => {
  const status = await collectWorkspaceStatus(context.rootDir);
  if (!status.ok) {
    return failed(status.error);
  }
  const repos = await collectWorkspaceRepositoryContext(context.rootDir);
  if (context.format === 'json') {
    writeJson(context, cliStatusOutputSchema, {
      schemaVersion: 1,
      command: 'status',
      ...status.value,
      ...(repos.ok
        ? {
            repositories: [...repos.value.repositories],
            candidateRepositories: [...repos.value.candidates],
            // Roster limitations belong on the status (item 9): what was NOT covered, and why.
            limitations: [...repos.value.limitations],
          }
        : {}),
      // Which build produced this answer. Version only — never an invented hash or date.
      server: { name: CLI_NAME, version: readOwnVersion() },
    });
    return succeeded();
  }
  writeLines(context, textLines(status.value, repos.ok ? repos.value : undefined));
  return succeeded();
};
