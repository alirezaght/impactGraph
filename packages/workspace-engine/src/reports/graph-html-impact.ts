import {
  likelihoodMeter,
  likelihoodText,
  LIKELIHOOD_STYLES,
  METER_WIDTH,
  PROPOSED_BADGE,
  PROPOSED_DASH,
  PROPOSED_SOURCE_MARKER,
} from './graph-impact-style.js';
import { markerElement, styleFor } from './graph-style.js';
import { escapeXml, formatCount, plural } from './graph-text.js';

import type { ImpactViewFacts } from './graph-impact-model.js';
import type { GraphView } from './graph-view-model.js';

// The impact view's own prose: what the analysis is, what it covers, what the budget hid, and the
// legend for the two encodings a reader has to hold at once — likelihood and provenance.

/**
 * §33 budget + coverage, stated in words with both numbers. A reader never has to wonder whether
 * the picture is the whole picture, and a requirement the analysis said nothing about is named
 * rather than left as a gap in a table.
 */
export const impactBudgetStatements = (view: GraphView, facts: ImpactViewFacts): string[] => {
  const totals = facts.totals;
  const budget = view.budget;
  const statements = [
    `${formatCount(totals.impactCount)} predicted impacts on ${formatCount(totals.componentCount)} components, from ${formatCount(totals.requirementsWithImpacts)} of ${formatCount(totals.requirementCount)} requirements. Showing ${formatCount(totals.componentsShown)} of ${formatCount(totals.componentCount)} components across ${formatCount(budget.groupsShown)} of ${formatCount(budget.groups)} ${view.grouping} groups.`,
    `${formatCount(totals.directCount)} impacts are direct concept matches; ${formatCount(totals.indirectCount)} were reached by dependency traversal, up to ${plural(totals.maxHops, 'hop')} away. An impact reached at two hops is a weaker claim than a direct match, so every row states its hop count.`,
    `${formatCount(totals.crossGroupHops)} dependency hops cross a group boundary and ${formatCount(totals.crossGroupHopsDrawn)} of those are drawn as aggregated arrows; hops inside a single group (${formatCount(view.edgeTotals.intraGroup)}) are not drawn because the group box already contains both ends.`,
  ];
  if (totals.requirementsWithoutImpacts > 0) {
    statements.push(
      `${formatCount(totals.requirementsWithoutImpacts)} of ${formatCount(totals.requirementCount)} requirements produced no impacts at all. The analysis says nothing about them — that is a gap in the analysis, not evidence that nothing changes. They are listed in the Requirements table.`,
    );
  }
  if (budget.hiddenNodes > 0) {
    statements.push(
      `Node budget reached: ${formatCount(budget.hiddenNodes)} components are not drawn, because a first paint is capped at ${formatCount(budget.maxVisibleNodes)} nodes (PRD §33). The strongest claims are kept, and every impact is still listed in the Impacts table below.`,
    );
  }
  if (budget.groupsHidden > 0) {
    statements.push(
      `${formatCount(budget.groupsHidden)} groups are not drawn for the same reason; the largest groups are kept.`,
    );
  }
  if (view.edgeTotals.truncated) {
    statements.push(
      `Relationship budget reached: showing ${formatCount(view.edgeTotals.aggregatedShown)} of ${formatCount(view.edgeTotals.aggregated)} aggregated relationships, strongest first.`,
    );
  }
  return statements;
};

/** Staleness and approval state — never implied, always stated (§40.2/§40.3). */
const provenanceNotes = (facts: ImpactViewFacts): string[] => {
  const notes: string[] = [];
  if (!facts.snapshotMatches) {
    notes.push(
      `This analysis was computed against repository snapshot ${facts.boundSnapshotId}. Component names, types and paths below were resolved against ${facts.resolvedSnapshotId}, which is a different snapshot — treat the two as possibly divergent, and re-analyze if that matters.`,
    );
  }
  if (facts.specificationStale) {
    notes.push(
      `The specification has moved on: this analysis saw version ${formatCount(facts.specificationVersion)} and the stored specification is now at version ${formatCount(facts.currentSpecificationVersion)}. The analysis is stale and was not silently refreshed.`,
    );
  }
  if (facts.analysisStatus !== 'approved') {
    notes.push(
      `Analysis status is '${facts.analysisStatus}', not 'approved'. Nothing here has been accepted by a human as a review baseline.`,
    );
  }
  return notes;
};

const definition = (term: string, value: string): string =>
  `<dt>${escapeXml(term)}</dt><dd>${value}</dd>`;

export const impactSummarySection = (view: GraphView, facts: ImpactViewFacts): string =>
  [
    `<section aria-labelledby="summary-heading">`,
    `<h2 id="summary-heading">What this shows</h2>`,
    `<dl class="facts">`,
    definition('Specification', escapeXml(facts.specificationTitle)),
    definition(
      'Specification source',
      facts.specificationSource === undefined
        ? 'not recorded'
        : `<code>${escapeXml(facts.specificationSource)}</code>`,
    ),
    definition(
      'Specification version',
      `${formatCount(facts.specificationVersion)}${facts.specificationStale ? ` (stale — latest is ${formatCount(facts.currentSpecificationVersion)})` : ''}`,
    ),
    definition('Analysis', `<code>${escapeXml(facts.analysisId)}</code>`),
    definition('Analysis status', escapeXml(facts.analysisStatus)),
    definition('Analysed at', escapeXml(facts.createdAt)),
    definition('Repository snapshot', `<code>${escapeXml(facts.boundSnapshotId)}</code>`),
    definition('Grouping', escapeXml(view.grouping)),
    definition('Predicted impacts', formatCount(facts.totals.impactCount)),
    definition('Components affected', formatCount(facts.totals.componentCount)),
    `</dl>`,
    ...provenanceNotes(facts).map((note) => `<p class="budget">${escapeXml(note)}</p>`),
    ...impactBudgetStatements(view, facts).map(
      (line) => `<p class="budget">${escapeXml(line)}</p>`,
    ),
    `</section>`,
  ].join('');

/** A swatch drawn with the same meter code the diagram uses, so the legend cannot drift. */
const meterSwatch = (likelihood: (typeof LIKELIHOOD_STYLES)[number]['likelihood']): string =>
  [
    `<svg class="swatch" viewBox="0 0 ${String(METER_WIDTH + 6)} 18" width="${String(METER_WIDTH + 6)}" height="18" aria-hidden="true" focusable="false">`,
    likelihoodMeter(likelihood, 3, 4),
    `</svg>`,
  ].join('');

export const likelihoodLegendSection = (): string =>
  [
    `<section aria-labelledby="likelihood-heading">`,
    `<h2 id="likelihood-heading">Legend — likelihood, the primary signal</h2>`,
    `<p>Likelihood (PRD §13) is what a reader acts on, so it is encoded three times over and never by colour: a <strong>four-segment meter</strong> (filled segments are solid, the rest are hollow outlines), the <strong>spelled-out word</strong>, and the <strong>fraction in text</strong>. Confidence is printed as a number to two decimals beside it, and every impact&rsquo;s contributing signals are listed in the Impacts table — a score without its signals is not an explanation (§14).</p>`,
    `<ul class="legend">`,
    ...LIKELIHOOD_STYLES.map(
      (style) =>
        `<li>${meterSwatch(style.likelihood)}<div><span class="badge">${escapeXml(likelihoodText(style.likelihood))}</span> <strong>${escapeXml(style.badge)}</strong><p>${escapeXml(style.description)}</p></div></li>`,
    ),
    `</ul>`,
    `<p class="note">Likelihood and provenance are independent readings of the same box and never share a channel: likelihood is the meter and the word inside the box, provenance is the box&rsquo;s border shape, its dash pattern and its ${escapeXml(styleFor('deterministic').badge)}-style badge. A component predicted as REQUIRED by an AI-inferred claim therefore still looks nothing like a deterministic one.</p>`,
    `</section>`,
  ].join('');

/** Only rendered when the analysis actually carries proposed structure. */
export const proposedLegendSection = (): string =>
  [
    `<section aria-labelledby="proposed-legend-heading">`,
    `<h2 id="proposed-legend-heading">Legend — current versus proposed structure</h2>`,
    `<svg class="swatch" viewBox="0 0 140 24" width="140" height="24" aria-hidden="true" focusable="false">`,
    markerElement(PROPOSED_SOURCE_MARKER, 'legend-'),
    markerElement('arrow-fact', 'legend-proposed-'),
    `<path class="edge-line" d="M 10 12 L 130 12" marker-start="url(#legend-${PROPOSED_SOURCE_MARKER})" marker-end="url(#legend-proposed-arrow-fact)" stroke-dasharray="${PROPOSED_DASH}" />`,
    `</svg>`,
    `<p>A <span class="badge">${PROPOSED_BADGE}</span> relationship or component is one an architectural option <em>would create</em>. It does not exist in the repository. It is drawn with a <strong>long dash</strong> that no provenance pattern produces, a <strong>marker at the source end</strong> that no current relationship draws at all, and the word <code>[${PROPOSED_BADGE}]</code> in its label — and it is aggregated separately, so a current relationship and a proposed one between the same two groups stay two distinct arrows (§3, §18.4). Proposed components are collected in their own group; they are never placed inside a real bounded context.</p>`,
    `</section>`,
  ].join('');
