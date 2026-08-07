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
  if (context.format === 'json') {
    renderJson(context, summary.value);
  } else {
    renderText(context, summary.value);
  }
  return succeeded();
};

/** Item 6 boundary blocks — additive, absent when nothing is declared/registered. */
const boundaryJson = (summary: ArchitectureSummary): Record<string, unknown> => ({
  ...(summary.contexts === undefined
    ? {}
    : {
        contexts: summary.contexts.map((entry) => ({
          name: entry.name,
          memberCount: entry.memberCount,
          ...(entry.samplePaths === undefined ? {} : { samplePaths: [...entry.samplePaths] }),
        })),
      }),
  ...(summary.repositories === undefined ? {} : { repositories: [...summary.repositories] }),
  ...(summary.crossRepositoryEdges === undefined
    ? {}
    : {
        crossRepositoryEdges: {
          count: summary.crossRepositoryEdges.count,
          samples: summary.crossRepositoryEdges.samples.map((sample) => ({
            ...sample,
            repositories: [...sample.repositories],
          })),
        },
      }),
  ...(summary.integrationPoints === undefined
    ? {}
    : { integrationPoints: summary.integrationPoints }),
  ...(summary.contracts === undefined ? {} : { contracts: [...summary.contracts] }),
});

const renderJson = (context: CommandContext, summary: ArchitectureSummary): void => {
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
    ...boundaryJson(summary),
  });
};

const typeLine = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}=${String(count)}`)
    .join('  ');

/** Item 6 boundary blocks in the human-readable rendering. */
const boundaryLines = (summary: ArchitectureSummary): readonly string[] => [
  ...(summary.contexts === undefined
    ? []
    : [
        'bounded contexts:',
        ...summary.contexts.map(
          (entry) => `  - ${entry.name} (${String(entry.memberCount)} members)`,
        ),
      ]),
  ...(summary.repositories === undefined
    ? []
    : [
        'repositories:',
        ...summary.repositories.map(
          (repo) =>
            `  - ${repo.name} (${String(repo.nodeCount)} nodes, ${String(repo.fileCount)} files)`,
        ),
        `cross-repository edges: ${String(summary.crossRepositoryEdges?.count ?? 0)}`,
      ]),
  ...(summary.integrationPoints === undefined
    ? []
    : [`integration points: ${typeLine(summary.integrationPoints)}`]),
];

const renderText = (context: CommandContext, summary: ArchitectureSummary): void => {
  writeLines(context, [
    `snapshot: ${summary.snapshotId}`,
    ...(summary.workspaces.length > 0 ? [`workspaces: ${summary.workspaces.join(', ')}`] : []),
    'packages:',
    ...summary.packages.map((pkg) => `  - ${pkg.name} (${String(pkg.fileCount)} files)`),
    `nodes (${String(summary.totalNodes)}): ${typeLine(summary.nodeCountsByType)}`,
    `edges (${String(summary.totalEdges)}): ${typeLine(summary.edgeCountsByType)}`,
    ...boundaryLines(summary),
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
