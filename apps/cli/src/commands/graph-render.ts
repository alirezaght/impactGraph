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

/** Impact-view headline: what a reader of the terminal needs before opening the file. */
const impactLines = (view: GraphView): string[] => {
  const facts = view.impact;
  if (facts === undefined) {
    return [];
  }
  const totals = facts.totals;
  const byLikelihood = totals.byLikelihood;
  const lines = [
    `analysis: ${facts.analysisId} (${facts.analysisStatus})`,
    `specification: ${facts.specificationTitle} v${String(facts.specificationVersion)}`,
    `impacts: ${String(totals.impactCount)} on ${String(totals.componentCount)} components — required ${String(byLikelihood.required)}, likely ${String(byLikelihood.likely)}, possible ${String(byLikelihood.possible)}, unlikely ${String(byLikelihood.unlikely)}`,
    `reach: ${String(totals.directCount)} direct, ${String(totals.indirectCount)} indirect up to ${String(totals.maxHops)} hops`,
    `requirements: ${String(totals.requirementsWithImpacts)} of ${String(totals.requirementCount)} produced impacts`,
  ];
  if (totals.requirementsWithoutImpacts > 0) {
    lines.push(
      `coverage gap: ${String(totals.requirementsWithoutImpacts)} requirements produced no impacts — the analysis says nothing about them`,
    );
  }
  if (!facts.snapshotMatches) {
    lines.push(
      `snapshot drift: analysis bound to ${facts.boundSnapshotId}, names resolved against ${facts.resolvedSnapshotId}`,
    );
  }
  if (facts.specificationStale) {
    lines.push(
      `stale: the specification is now at v${String(facts.currentSpecificationVersion)} — re-analyze to refresh`,
    );
  }
  if (facts.warnings.length > 0) {
    lines.push(`warnings: ${String(facts.warnings.length)} — listed in the file`);
  }
  return lines;
};

const architectureLines = (view: GraphView): string[] => {
  const budget = view.budget;
  return [
    `snapshot: ${view.snapshotId}`,
    `nodes: ${String(budget.shownNodes)} of ${String(budget.architectureNodes)} architecture-level drawn (${String(budget.graphNodes)} indexed in total)`,
  ];
};

const summaryLines = (context: CommandContext, written: GraphExportResult): string[] => {
  const view = written.view;
  const budget = view.budget;
  const totals = view.edgeTotals;
  const lines = [
    `wrote ${displayPath(context.rootDir, written.path)} (${formatBytes(written.byteSize)})`,
    ...(view.impact === undefined ? architectureLines(view) : impactLines(view)),
    `grouping: ${view.grouping} — ${String(budget.groupsShown)} of ${String(budget.groups)} groups drawn`,
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
