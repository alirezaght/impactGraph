import { PROPOSED_BADGE } from './graph-impact-style.js';
import { CATEGORY_STYLES, markerElement, styleFor } from './graph-style.js';
import { escapeXml, formatCount } from './graph-text.js';

import type { CategoryStyle } from './graph-style.js';
import type { GraphView, GraphViewEdge, GraphViewGroup } from './graph-view-model.js';

// The non-diagram half of the export: the budget statement, the legend, and the two tables that
// carry EVERY fact the diagram shows. §37 — the picture is never the only access path, so a
// screen-reader or text-only reader loses nothing by ignoring the SVG.

const row = (cells: readonly string[]): string =>
  `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;

const headerRow = (cells: readonly string[]): string =>
  `<tr>${cells.map((cell) => `<th scope="col">${cell}</th>`).join('')}</tr>`;

/**
 * The §33 budget statement. Truncation is always stated in words with both numbers; a reader
 * never has to wonder whether the picture is the whole picture.
 */
export const budgetStatements = (view: GraphView): readonly string[] => {
  const budget = view.budget;
  const totals = view.edgeTotals;
  const statements = [
    `Showing ${formatCount(budget.shownNodes)} of ${formatCount(budget.architectureNodes)} architecture-level nodes across ${formatCount(budget.groupsShown)} of ${formatCount(budget.groups)} ${view.grouping} groups. The indexed graph holds ${formatCount(budget.graphNodes)} nodes in total — file-, directory- and symbol-level detail is aggregated into the per-group counts below instead of being drawn.`,
    `${formatCount(totals.interGroup)} of ${formatCount(totals.graphEdges)} relationships cross a group boundary and are aggregated into ${formatCount(totals.aggregated)} labelled arrows. ${formatCount(totals.intraGroup)} stay inside a single group and ${formatCount(totals.containment)} are CONTAINS edges already expressed by the boxes.`,
  ];
  if (budget.hiddenNodes > 0) {
    statements.push(
      `Node budget reached: ${formatCount(budget.hiddenNodes)} architecture-level nodes are not drawn, because a first paint is capped at ${formatCount(budget.maxVisibleNodes)} nodes (PRD §33). Nothing is silently dropped — every group lists its full node count.`,
    );
  }
  if (budget.groupsHidden > 0) {
    statements.push(
      `${formatCount(budget.groupsHidden)} groups are not drawn for the same reason; the largest groups are kept.`,
    );
  }
  if (totals.truncated) {
    statements.push(
      `Relationship budget reached: showing ${formatCount(totals.aggregatedShown)} of ${formatCount(totals.aggregated)} aggregated relationships, strongest first.`,
    );
  }
  return statements;
};

export const summarySection = (view: GraphView): string =>
  [
    `<section aria-labelledby="summary-heading">`,
    `<h2 id="summary-heading">What this shows</h2>`,
    `<dl class="facts">`,
    `<dt>Repository snapshot</dt><dd><code>${escapeXml(view.snapshotId)}</code></dd>`,
    `<dt>Grouping</dt><dd>${escapeXml(view.grouping)}</dd>`,
    `<dt>Groups drawn</dt><dd>${formatCount(view.groups.length)}</dd>`,
    `<dt>Component nodes drawn</dt><dd>${formatCount(view.nodes.length)}</dd>`,
    `<dt>Relationships drawn</dt><dd>${formatCount(view.edges.length)}</dd>`,
    `</dl>`,
    ...budgetStatements(view).map((line) => `<p class="budget">${escapeXml(line)}</p>`),
    `</section>`,
  ].join('');

/** A 78×34 swatch drawn with the same code path the diagram uses, so the legend cannot drift. */
const swatch = (style: CategoryStyle): string => {
  const dash = style.dash === 'none' ? '' : ` stroke-dasharray="${style.dash}"`;
  const inner = style.doubleOutline
    ? `<rect class="node-shape inner" x="6" y="6" width="60" height="20" rx="${Math.max(0, style.radius - 1)}" stroke-width="1" fill="none" />`
    : '';
  return [
    `<svg class="swatch" viewBox="0 0 108 32" width="108" height="32" aria-hidden="true" focusable="false">`,
    `<rect class="node-shape" x="3" y="3" width="66" height="26" rx="${style.radius}" stroke-width="${style.strokeWidth}"${dash} />`,
    inner,
    markerElement(style.marker, 'legend-'),
    `<path class="edge-line" d="M 74 16 L 100 16" marker-end="url(#legend-${style.marker})"${dash} />`,
    `</svg>`,
  ].join('');
};

export const legendSection = (): string =>
  [
    `<section aria-labelledby="legend-heading">`,
    `<h2 id="legend-heading">Legend — the three knowledge categories</h2>`,
    `<p>Deterministic facts, AI-inferred interpretations and human-confirmed knowledge are never mixed (PRD §3). Each is distinguished by <strong>shape, border stroke, arrowhead and a spelled-out text badge</strong> — never by colour alone (§37). This file uses no colour to carry meaning at all.</p>`,
    `<ul class="legend">`,
    ...CATEGORY_STYLES.map(
      (style) =>
        `<li>${swatch(style)}<div><span class="badge">${escapeXml(style.badge)}</span> <strong>${escapeXml(style.label)}</strong><p>${style.description}</p></div></li>`,
    ),
    `</ul>`,
    `<p class="note">Arrows point from the source group to the target group; the arrowhead is the only direction cue and its <em>shape</em> also encodes the relationship’s knowledge category. Outer boxes are grouping containers, not knowledge records, so they carry no category styling — the counts inside them break their contents down by category.</p>`,
    `</section>`,
  ].join('');

const categoryCells = (group: GraphViewGroup): string =>
  CATEGORY_STYLES.map((style) => formatCount(group.countsByKnowledgeCategory[style.category])).join(
    '</td><td>',
  );

export const groupsTable = (view: GraphView): string =>
  [
    `<section aria-labelledby="groups-heading">`,
    `<h2 id="groups-heading">Groups</h2>`,
    `<table><caption>${
      view.kind === 'impact'
        ? 'Every group drawn in the diagram, with how many of its components the analysis predicts an impact on, broken down by the provenance of those predictions.'
        : 'Every group drawn in the diagram, with its full node count and the provenance breakdown of those nodes.'
    }</caption><thead>`,
    headerRow([
      'Group',
      view.kind === 'impact' ? 'Components impacted' : 'Nodes (all levels)',
      'Drawn',
      'Not drawn',
      ...CATEGORY_STYLES.map((style) => style.badge),
    ]),
    `</thead><tbody>`,
    ...view.groups.map((group) =>
      row([
        escapeXml(group.label),
        formatCount(group.totalNodes),
        formatCount(group.shownNodes),
        formatCount(group.hiddenNodes),
        categoryCells(group),
      ]),
    ),
    `</tbody></table>`,
    `</section>`,
  ].join('');

const kindList = (edge: GraphViewEdge): string =>
  edge.kinds.map((kind) => `${escapeXml(kind.type)} ×${formatCount(kind.count)}`).join(', ');

/** A proposed relationship is labelled as such in the table too, not only in the diagram (§18.4). */
const statusCell = (edge: GraphViewEdge): string =>
  edge.status === 'proposed'
    ? `<span class="badge">${PROPOSED_BADGE}</span> would be created`
    : 'current';

export const edgesTable = (view: GraphView): string =>
  [
    `<section aria-labelledby="edges-heading">`,
    `<h2 id="edges-heading">Relationships</h2>`,
    `<table><caption>Aggregated group-to-group relationships. Aggregation never crosses knowledge categories — nor current versus proposed status — so a deterministic dependency, an inferred one and a proposed one are listed separately.</caption><thead>`,
    headerRow(['From', 'To', 'Relationship types', 'Edges', 'Category', 'Status']),
    `</thead><tbody>`,
    ...view.edges.map((edge) =>
      row([
        escapeXml(edge.sourceGroupId),
        escapeXml(edge.targetGroupId),
        kindList(edge),
        formatCount(edge.count),
        `<span class="badge">${escapeXml(styleFor(edge.knowledgeCategory).badge)}</span>`,
        statusCell(edge),
      ]),
    ),
    `</tbody></table>`,
    `</section>`,
  ].join('');

export const nodesTable = (view: GraphView): string =>
  [
    `<section aria-labelledby="nodes-heading">`,
    `<h2 id="nodes-heading">Component nodes</h2>`,
    `<table><caption>Every component node drawn in the diagram. Names, types, repository-relative paths and provenance only — this export contains no source code and no evidence text.</caption><thead>`,
    headerRow(['Group', 'Name', 'Type', 'Path', 'Provenance', 'Category']),
    `</thead><tbody>`,
    ...view.nodes.map((node) =>
      row([
        escapeXml(node.groupId),
        escapeXml(node.name),
        escapeXml(node.type),
        node.path === undefined ? '—' : `<code>${escapeXml(node.path)}</code>`,
        escapeXml(node.provenance),
        `<span class="badge">${escapeXml(styleFor(node.knowledgeCategory).badge)}</span>`,
      ]),
    ),
    `</tbody></table>`,
    `</section>`,
  ].join('');
