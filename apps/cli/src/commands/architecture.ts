import { existsSync } from 'node:fs';

import { cliArchitectureOutputSchema } from '@impactgraph/contracts';
import { indexDatabasePath } from '@impactgraph/persistence';
import { summarizeArchitecture } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { ArchitectureSummary } from '@impactgraph/workspace-engine';

export const runArchitecture = async (context: CommandContext): Promise<CommandResult> => {
  if (!existsSync(indexDatabasePath(context.rootDir))) {
    return failed({
      category: 'configurationError',
      message: 'no index found — run `impactgraph index` first',
    });
  }
  const summary = await summarizeArchitecture(context.rootDir);
  if (!summary.ok) {
    return failed(summary.error);
  }
  render(context, summary.value);
  return succeeded();
};

const render = (context: CommandContext, summary: ArchitectureSummary): void => {
  if (context.format === 'json') {
    writeJson(context, cliArchitectureOutputSchema, {
      schemaVersion: 1,
      command: 'architecture',
      snapshotId: summary.snapshotId,
      workspaces: [...summary.workspaces],
      packages: [...summary.packages],
      nodeCountsByType: summary.nodeCountsByType,
      edgeCountsByType: summary.edgeCountsByType,
      totalNodes: summary.totalNodes,
      totalEdges: summary.totalEdges,
      corrections: summary.corrections,
      effectiveTotalEdges: summary.effectiveTotalEdges,
      rejectedEdges: summary.rejectedEdges.map((edge) => ({
        edgeId: edge.edgeId,
        level: edge.level,
        ...(edge.reason === undefined ? {} : { reason: edge.reason }),
      })),
    });
    return;
  }
  const typeLine = (counts: Record<string, number>): string =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${type}=${String(count)}`)
      .join('  ');
  writeLines(context, [
    `snapshot: ${summary.snapshotId}`,
    ...(summary.workspaces.length > 0 ? [`workspaces: ${summary.workspaces.join(', ')}`] : []),
    'packages:',
    ...summary.packages.map((pkg) => `  - ${pkg.name} (${String(pkg.fileCount)} files)`),
    `nodes (${String(summary.totalNodes)}): ${typeLine(summary.nodeCountsByType)}`,
    `edges (${String(summary.totalEdges)}): ${typeLine(summary.edgeCountsByType)}`,
    // §16: rejected relationships are named, never quietly subtracted from the totals.
    ...(summary.rejectedEdges.length > 0
      ? [
          `effective edges (${String(summary.effectiveTotalEdges)}) — ${String(summary.rejectedEdges.length)} relationship(s) rejected by human correction:`,
          ...summary.rejectedEdges.map(
            (edge) => `  - ${edge.edgeId} (${edge.level}): ${edge.reason ?? 'no reason recorded'}`,
          ),
        ]
      : []),
  ]);
};
