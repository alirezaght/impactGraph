import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { failWith } from '../failure.js';

import { renderGraphHtml } from './graph-html.js';
import { loadImpactView } from './graph-impact-source.js';
import { loadGraphView } from './graph-view-source.js';

import type { Failable } from '../failure.js';
import type { GraphGrouping, GraphView } from './graph-view-model.js';

// The one place the HTML export is written to disk, shared by `impactgraph graph` and the
// `export_graph_html` MCP tool. Rendering stays pure (graph-html.ts); this file owns the two
// things a caller must not get wrong: where the file may land, and reporting what was produced.

export const DEFAULT_GRAPH_FILENAME = 'impactgraph-graph.html';

/** Default destination for an impact export, so the two views never overwrite each other. */
export const DEFAULT_IMPACT_FILENAME = 'impactgraph-impact.html';

export interface GraphExportRequest {
  readonly rootDir: string;
  readonly grouping: GraphGrouping;
  /**
   * Which view to render. Absent renders the current architecture — exactly as before. Present
   * renders that stored analysis's blast radius instead; an unknown id is a configuration error.
   */
  readonly analysisId?: string | undefined;
  /** Destination, relative to `rootDir` unless absolute. Defaults to the workspace root file. */
  readonly outPath?: string | undefined;
  /**
   * A human typing `--out /tmp/x.html` means it. An MCP client does not: its working directory
   * is arbitrary and it is an agent, so tool-supplied paths are confined to the workspace.
   */
  readonly allowOutsideRoot: boolean;
}

export interface GraphExportResult {
  readonly path: string;
  readonly byteSize: number;
  readonly view: GraphView;
}

const defaultFilenameFor = (request: GraphExportRequest): string =>
  request.analysisId === undefined ? DEFAULT_GRAPH_FILENAME : DEFAULT_IMPACT_FILENAME;

export const resolveGraphOutPath = (request: GraphExportRequest): Failable<string> => {
  const requested = request.outPath ?? defaultFilenameFor(request);
  const root = resolve(request.rootDir);
  const target = isAbsolute(requested) ? requested : resolve(root, requested);
  if (request.allowOutsideRoot) {
    return { ok: true, value: target };
  }
  const inside = relative(root, target);
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    return failWith(
      'configurationError',
      `refusing to write outside the workspace: '${requested}' must be a path inside the analyzed repository`,
    );
  }
  return { ok: true, value: target };
};

/** One renderer, two view sources — the caller's `analysisId` chooses which one supplies the view. */
const loadViewFor = async (request: GraphExportRequest): Promise<Failable<GraphView>> =>
  request.analysisId === undefined
    ? loadGraphView(request.rootDir, request.grouping)
    : loadImpactView({
        rootDir: request.rootDir,
        analysisId: request.analysisId,
        grouping: request.grouping,
      });

/** Load the view, render it, and write exactly one file. No network, no source content. */
export const exportGraphHtmlFile = async (
  request: GraphExportRequest,
): Promise<Failable<GraphExportResult>> => {
  const outPath = resolveGraphOutPath(request);
  if (!outPath.ok) {
    return outPath;
  }
  const view = await loadViewFor(request);
  if (!view.ok) {
    return view;
  }
  const html = renderGraphHtml(view.value);
  mkdirSync(dirname(outPath.value), { recursive: true });
  writeFileSync(outPath.value, html, 'utf8');
  return {
    ok: true,
    value: { path: outPath.value, byteSize: Buffer.byteLength(html, 'utf8'), view: view.value },
  };
};
