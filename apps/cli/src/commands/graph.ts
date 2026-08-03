import { existsSync } from 'node:fs';

import { indexDatabasePath } from '@impactgraph/persistence';
import { exportGraphHtmlFile, loadGraphView, loadImpactView } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';

import { renderGraphData, renderWrittenGraph } from './graph-render.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { Failable, GraphGrouping, GraphView } from '@impactgraph/workspace-engine';

// `impactgraph graph [--analysis <id>] [--out file.html] [--group context|application|package]
//                    [--format json]`
//
// Gives a CLI-only user a visual surface without VS Code: one self-contained local HTML file
// (inline SVG, zero JavaScript, zero network, no source content — see
// packages/workspace-engine/src/reports/graph-html.ts for the invariants it guarantees).
//
// Two views, one command. Without `--analysis` it renders the current architecture, exactly as
// before. With it, the same renderer draws a stored analysis's blast radius: which components a
// specification is predicted to touch, and with what likelihood.

const loadView = async (
  context: CommandContext,
  grouping: GraphGrouping,
): Promise<Failable<GraphView>> =>
  context.analysisId === undefined
    ? loadGraphView(context.rootDir, grouping)
    : loadImpactView({ rootDir: context.rootDir, analysisId: context.analysisId, grouping });

export const runGraph = async (context: CommandContext): Promise<CommandResult> => {
  if (!existsSync(indexDatabasePath(context.rootDir))) {
    return failed({
      category: 'configurationError',
      message: 'no index found — run `impactgraph index` first',
    });
  }
  const grouping: GraphGrouping = context.grouping ?? 'context';
  // `--format json` on its own is a query, not an export: it writes no file unless asked to.
  if (context.format === 'json' && context.outPath === undefined) {
    const view = await loadView(context, grouping);
    if (!view.ok) {
      return failed(view.error);
    }
    renderGraphData(context, view.value);
    return succeeded();
  }
  const written = await exportGraphHtmlFile({
    rootDir: context.rootDir,
    grouping,
    analysisId: context.analysisId,
    outPath: context.outPath,
    // A human asking for `--out /tmp/x.html` means it; only tool-supplied paths are confined.
    allowOutsideRoot: true,
  });
  if (!written.ok) {
    return failed(written.error);
  }
  renderWrittenGraph(context, written.value);
  return succeeded();
};
