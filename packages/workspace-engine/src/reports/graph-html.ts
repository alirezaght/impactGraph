import {
  edgesTable,
  groupsTable,
  legendSection,
  nodesTable,
  summarySection,
} from './graph-html-sections.js';
import { GRAPH_STYLESHEET } from './graph-html-style.js';
import { layoutGraphView } from './graph-layout.js';
import { renderGraphSvg } from './graph-svg.js';
import { escapeXml, formatCount } from './graph-text.js';

import type { GraphView } from './graph-view-model.js';

// `impactgraph graph` / `export_graph_html` — one self-contained local HTML file.
//
// Invariants this renderer exists to guarantee:
//   * ZERO network. No script src, no stylesheet link, no web font, no image URL, no fetch.
//     Everything is inline; the file renders on an air-gapped machine, forever.
//   * ZERO JavaScript. The diagram is inline SVG; browsers zoom and pan it natively, so
//     interactivity is not worth a script tag (and a script tag is a supply-chain surface).
//   * ZERO source content. Names, types, repository-relative paths, provenance and counts only —
//     never a line of code, never an evidence excerpt. The file is safe to attach to a ticket.
//   * DETERMINISTIC. No clock, no randomness, no absolute paths. Re-exporting an unchanged graph
//     produces byte-identical output, which is what makes the golden test meaningful.

const FOOTER_NOTE =
  'Generated locally by ImpactGraph from the indexed repository graph. This file contains no source code, no evidence text and no remote references — it loads no scripts, fonts, stylesheets or images from anywhere. Deterministic facts, AI-inferred interpretations and human-confirmed knowledge are rendered as separate categories and are never merged.';

const headline = (view: GraphView): string =>
  `${formatCount(view.groups.length)} ${view.grouping} groups · ${formatCount(view.nodes.length)} components · ${formatCount(view.edges.length)} relationships · snapshot ${view.snapshotId}`;

/**
 * Render the whole document. Pure: `view` in, HTML string out — no file system, no clock.
 * Callers (the CLI command, the MCP tool) own the write.
 */
export const renderGraphHtml = (view: GraphView): string => {
  const layout = layoutGraphView(view);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    `<title>ImpactGraph architecture — grouped by ${escapeXml(view.grouping)}</title>`,
    `<style>${GRAPH_STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<a class="skip" href="#groups-heading">Skip the diagram and read the tables</a>',
    '<h1>ImpactGraph architecture</h1>',
    `<p class="subtitle">${escapeXml(headline(view))}</p>`,
    summarySection(view),
    legendSection(),
    '<section aria-labelledby="diagram-heading">',
    '<h2 id="diagram-heading">Diagram</h2>',
    '<p class="note">Zoom with your browser (the diagram is vector art, so it stays sharp at any scale). Every group, component and relationship shown here is also listed in the tables below.</p>',
    `<div class="scroller">${renderGraphSvg(view, layout)}</div>`,
    '</section>',
    groupsTable(view),
    edgesTable(view),
    nodesTable(view),
    `<footer><p>${escapeXml(FOOTER_NOTE)}</p></footer>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
};
