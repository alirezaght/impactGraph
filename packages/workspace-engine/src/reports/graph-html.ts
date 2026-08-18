import {
  impactsTable,
  proposedTables,
  requirementsTable,
  unresolvedSurfacesTable,
  warningsTable,
} from './graph-html-impact-tables.js';
import {
  impactSummarySection,
  likelihoodLegendSection,
  proposedLegendSection,
} from './graph-html-impact.js';
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

import type { ImpactViewFacts } from './graph-impact-model.js';
import type { GraphView } from './graph-view-model.js';

// `impactgraph graph` / `export_graph_html` — one self-contained local HTML file, for either of the
// two view sources (the current architecture, or a stored analysis's blast radius).
//
// Invariants this renderer exists to guarantee:
//   * ZERO network. No script src, no stylesheet link, no web font, no image URL, no fetch.
//     Everything is inline; the file renders on an air-gapped machine, forever.
//   * ZERO JavaScript. The diagram is inline SVG; browsers zoom and pan it natively, so
//     interactivity is not worth a script tag (and a script tag is a supply-chain surface).
//   * ZERO source content. Names, types, repository-relative paths, provenance, requirement text
//     and counts only — never a line of code, never an evidence excerpt, never an evidence line
//     range. The file is safe to attach to a ticket.
//   * DETERMINISTIC. No clock, no randomness, no absolute paths. Re-exporting an unchanged graph or
//     an unchanged analysis produces byte-identical output, which makes the golden meaningful.

const ARCHITECTURE_FOOTER =
  'Generated locally by ImpactGraph from the indexed repository graph. This file contains no source code, no evidence text and no remote references — it loads no scripts, fonts, stylesheets or images from anywhere. Deterministic facts, AI-inferred interpretations and human-confirmed knowledge are rendered as separate categories and are never merged.';

const IMPACT_FOOTER =
  'Generated locally by ImpactGraph from a stored impact analysis. It is a PREDICTION of where a specification is likely to land, not a record of any change that was made, and it is not a substitute for review. This file contains no source code, no evidence text and no remote references — it loads no scripts, fonts, stylesheets or images from anywhere. Deterministic facts, AI-inferred interpretations and human-confirmed knowledge are rendered as separate categories and are never merged, and proposed structure is never merged with current structure.';

const architectureHeadline = (view: GraphView): string =>
  `${formatCount(view.groups.length)} ${view.grouping} groups · ${formatCount(view.nodes.length)} components · ${formatCount(view.edges.length)} relationships · snapshot ${view.snapshotId}`;

const impactHeadline = (view: GraphView, facts: ImpactViewFacts): string =>
  `${formatCount(facts.totals.impactCount)} impacts · ${formatCount(facts.totals.componentCount)} components · ${formatCount(facts.totals.requirementsWithImpacts)} of ${formatCount(facts.totals.requirementCount)} requirements · ${formatCount(view.groups.length)} ${view.grouping} groups · snapshot ${facts.boundSnapshotId}`;

/** Returned as separate lines, so the document's line structure stays diff-friendly. */
const diagramSection = (view: GraphView): string[] => [
  '<section aria-labelledby="diagram-heading">',
  '<h2 id="diagram-heading">Diagram</h2>',
  '<p class="note">Zoom with your browser (the diagram is vector art, so it stays sharp at any scale). Every group, component and relationship shown here is also listed in the tables below.</p>',
  `<div class="scroller">${renderGraphSvg(view, layoutGraphView(view))}</div>`,
  '</section>',
];

/** The architecture document: what the current index contains. */
const architectureBody = (view: GraphView): string[] => [
  '<a class="skip" href="#groups-heading">Skip the diagram and read the tables</a>',
  '<h1>ImpactGraph architecture</h1>',
  `<p class="subtitle">${escapeXml(architectureHeadline(view))}</p>`,
  summarySection(view),
  legendSection(),
  ...diagramSection(view),
  groupsTable(view),
  edgesTable(view),
  nodesTable(view),
  `<footer><p>${escapeXml(ARCHITECTURE_FOOTER)}</p></footer>`,
];

/**
 * The impact document: what a specification is predicted to touch. Requirements come BEFORE the
 * impacts table on purpose — sixty impacts are unreadable until you know which of ten requirements
 * produced them.
 */
const impactBody = (view: GraphView, facts: ImpactViewFacts): string[] => [
  '<a class="skip" href="#requirements-heading">Skip the diagram and read the tables</a>',
  '<h1>ImpactGraph impact analysis</h1>',
  `<p class="subtitle">${escapeXml(facts.specificationTitle)}</p>`,
  `<p class="subtitle">${escapeXml(impactHeadline(view, facts))}</p>`,
  impactSummarySection(view, facts),
  likelihoodLegendSection(),
  legendSection(),
  ...(facts.proposed === undefined ? [] : [proposedLegendSection()]),
  ...diagramSection(view),
  // Before the requirements and impact tables on purpose: an absent surface is work the plan has
  // to account for, and burying it under the components that DO exist is how it got missed.
  ...(facts.unresolvedSurfaces === undefined || facts.unresolvedSurfaces.length === 0
    ? []
    : [unresolvedSurfacesTable(facts.unresolvedSurfaces)]),
  requirementsTable(facts),
  groupsTable(view),
  edgesTable(view),
  impactsTable(facts),
  ...(facts.warnings.length === 0 ? [] : [warningsTable(facts)]),
  ...(facts.proposed === undefined ? [] : [proposedTables(facts.proposed)]),
  `<footer><p>${escapeXml(IMPACT_FOOTER)}</p></footer>`,
];

const title = (view: GraphView): string =>
  view.impact === undefined
    ? `ImpactGraph architecture — grouped by ${view.grouping}`
    : `ImpactGraph impact analysis — ${view.impact.specificationTitle}`;

/**
 * Render the whole document. Pure: `view` in, HTML string out — no file system, no clock.
 * Callers (the CLI command, the MCP tool) own the write.
 */
export const renderGraphHtml = (view: GraphView): string => {
  const facts = view.impact;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    `<title>${escapeXml(title(view))}</title>`,
    `<style>${GRAPH_STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<main>',
    ...(facts === undefined ? architectureBody(view) : impactBody(view, facts)),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
};
