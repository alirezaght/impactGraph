import { relative, resolve } from 'node:path';

import { cliGraphOutputSchema } from '@impactgraph/contracts';
import { buildGraphOutput } from '@impactgraph/workspace-engine';

import { writeJson, writeLines } from '../output.js';

import type { CommandContext } from '../context.js';
import type { GraphExportResult, GraphView } from '@impactgraph/workspace-engine';

// Terminal and JSON presentation for `impactgraph graph`. The engine did the rendering and the
// write (reports/graph-file.ts); this file only decides what the operator is told about it.

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KiB`;

/** Report the path relative to the root when it sits inside it — never echo a home directory. */
const displayPath = (rootDir: string, outPath: string): string => {
  const relativePath = relative(resolve(rootDir), outPath);
  return relativePath.startsWith('..') || relativePath.length === 0 ? outPath : relativePath;
};

const summaryLines = (context: CommandContext, written: GraphExportResult): string[] => {
  const view = written.view;
  const budget = view.budget;
  const totals = view.edgeTotals;
  const lines = [
    `wrote ${displayPath(context.rootDir, written.path)} (${formatBytes(written.byteSize)})`,
    `snapshot: ${view.snapshotId}`,
    `grouping: ${view.grouping} — ${String(budget.groupsShown)} of ${String(budget.groups)} groups drawn`,
    `nodes: ${String(budget.shownNodes)} of ${String(budget.architectureNodes)} architecture-level drawn (${String(budget.graphNodes)} indexed in total)`,
    `relationships: ${String(totals.aggregatedShown)} aggregated arrows from ${String(totals.interGroup)} cross-group edges`,
  ];
  if (budget.hiddenNodes > 0 || budget.groupsHidden > 0) {
    lines.push(
      `node budget: capped at ${String(budget.maxVisibleNodes)} (PRD §33) — the file states what it is not showing`,
    );
  }
  lines.push('self-contained: no scripts, no network, no source code — open it in any browser');
  return lines;
};

export const renderWrittenGraph = (context: CommandContext, written: GraphExportResult): void => {
  if (context.format === 'json') {
    writeJson(
      context,
      cliGraphOutputSchema,
      buildGraphOutput(written.view, {
        writtenPath: written.path,
        byteSize: written.byteSize,
      }),
    );
    return;
  }
  writeLines(context, summaryLines(context, written));
};

/** `--format json` without `--out` is the data view: it prints the view and writes nothing. */
export const renderGraphData = (context: CommandContext, view: GraphView): void => {
  writeJson(context, cliGraphOutputSchema, buildGraphOutput(view));
};
