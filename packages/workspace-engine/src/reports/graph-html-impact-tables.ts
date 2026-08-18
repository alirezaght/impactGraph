import { likelihoodText, PROPOSED_BADGE } from './graph-impact-style.js';
import { styleFor } from './graph-style.js';
import { escapeXml, formatCount, plural } from './graph-text.js';

import type {
  ImpactProposedFacts,
  ImpactRequirementRow,
  ImpactRow,
  ImpactViewFacts,
  UnresolvedSurfaceRow,
} from './graph-impact-model.js';

// §37 tree parity: the diagram is never the only access path. Everything the picture encodes — and
// more, because the diagram aggregates per component while these rows are per impact — is here as
// plain tables a screen reader or a text-only reader can walk.

const row = (cells: readonly string[]): string =>
  `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;

const headerRow = (cells: readonly string[]): string =>
  `<tr>${cells.map((cell) => `<th scope="col">${cell}</th>`).join('')}</tr>`;

const badge = (text: string): string => `<span class="badge">${escapeXml(text)}</span>`;

const section = (id: string, heading: string, caption: string, body: string): string =>
  [
    `<section aria-labelledby="${id}">`,
    `<h2 id="${id}">${escapeXml(heading)}</h2>`,
    `<table><caption>${caption}</caption>`,
    body,
    `</table>`,
    `</section>`,
  ].join('');

/** `—` is never used for "no data": absence is spelled out so it cannot be mistaken for a dash. */
const requirementCells = (entry: ImpactRequirementRow): string[] => [
  `<code>${escapeXml(entry.id)}</code>`,
  escapeXml(entry.statement),
  escapeXml(entry.priority ?? 'no priority recorded'),
  formatCount(entry.impactCount),
  formatCount(entry.componentCount),
  entry.strongestLikelihood === undefined
    ? 'no impacts predicted'
    : badge(likelihoodText(entry.strongestLikelihood)),
  entry.maxConfidence === undefined ? 'not scored' : entry.maxConfidence.toFixed(2),
  entry.warningCodes.length === 0
    ? 'none'
    : entry.warningCodes.map((code) => escapeXml(code)).join(', '),
];

export const requirementsTable = (facts: ImpactViewFacts): string =>
  section(
    'requirements-heading',
    'Requirements',
    'Every requirement extracted from the specification, including any that produced no impacts — requirement attribution for the whole analysis. Specification prose only; no repository source.',
    [
      `<thead>`,
      headerRow([
        'Requirement',
        'Statement',
        'Priority',
        'Impacts',
        'Components',
        'Strongest likelihood',
        'Max confidence',
        'Warnings',
      ]),
      `</thead><tbody>`,
      ...facts.requirements.map((entry) => row(requirementCells(entry))),
      `</tbody>`,
    ].join(''),
  );

/** §14 — the contributing signals behind the score, with their signed contributions. */
const signalText = (entry: ImpactRow): string =>
  entry.signals.length === 0
    ? 'no signals recorded'
    : entry.signals
        .map(
          (signal) =>
            `${escapeXml(signal.type)} ${signal.contribution >= 0 ? '+' : ''}${signal.contribution.toFixed(2)}${
              signal.description === undefined ? '' : ` (${escapeXml(signal.description)})`
            }`,
        )
        .join('; ');

/** The dependency path, so a two-hop claim can be checked hop by hop rather than trusted. */
const pathText = (entry: ImpactRow): string =>
  entry.hops === 0
    ? 'direct match — no traversal'
    : entry.dependencyPath.map((nodeId) => `<code>${escapeXml(nodeId)}</code>`).join(' &rarr; ');

const impactCells = (entry: ImpactRow): string[] => [
  badge(likelihoodText(entry.likelihood)),
  entry.confidence.toFixed(2),
  escapeXml(entry.impactType),
  escapeXml(entry.componentName),
  escapeXml(entry.groupId),
  `<code>${escapeXml(entry.requirementId)}</code>`,
  `${escapeXml(entry.directness)} · ${plural(entry.hops, 'hop')}`,
  `${escapeXml(entry.provenance)} ${badge(styleFor(entry.knowledgeCategory).badge)}`,
  escapeXml(entry.explanation),
  signalText(entry),
  pathText(entry),
  entry.expectedChanges.length === 0
    ? 'none recorded'
    : entry.expectedChanges.map((change) => escapeXml(change)).join('; '),
  formatCount(entry.evidenceCount),
  entry.decision === undefined
    ? 'no human decision'
    : `${escapeXml(entry.decision)}${entry.decisionReason === undefined ? '' : ` — ${escapeXml(entry.decisionReason)}`}`,
  entry.drawn ? 'yes' : 'not drawn (node budget)',
];

export const impactsTable = (facts: ImpactViewFacts): string =>
  section(
    'impacts-heading',
    'Impacts',
    'Every predicted impact, one row per requirement-and-component pair, strongest first. Confidence is shown with the contributing signals it was computed from (PRD §14). Evidence is reported as a count: evidence identifiers embed line ranges, which this export does not publish.',
    [
      `<thead>`,
      headerRow([
        'Likelihood',
        'Confidence',
        'Impact type',
        'Component',
        'Group',
        'Requirement',
        'Reach · hops',
        'Provenance',
        'Explanation',
        'Confidence signals (§14)',
        'Dependency path',
        'Expected changes',
        'Evidence',
        'Human decision',
        'Drawn',
      ]),
      `</thead><tbody>`,
      ...facts.impacts.map((entry) => row(impactCells(entry))),
      `</tbody>`,
    ].join(''),
  );

export const warningsTable = (facts: ImpactViewFacts): string =>
  section(
    'warnings-heading',
    'Analysis warnings',
    'What the analysis could not do. A warning here is a limit on the blast radius below, not a detail: an unknown concept or a traversal cutoff means the picture is incomplete in a specific, named way.',
    [
      `<thead>`,
      headerRow(['Code', 'Requirement', 'Message']),
      `</thead><tbody>`,
      ...facts.warnings.map((warning) =>
        row([
          escapeXml(warning.code),
          warning.requirementId === undefined
            ? 'whole analysis'
            : `<code>${escapeXml(warning.requirementId)}</code>`,
          escapeXml(warning.message),
        ]),
      ),
      `</tbody>`,
    ].join(''),
  );

const surfaceCells = (entry: UnresolvedSurfaceRow): string[] => [
  `${entry.primary ? badge('written commitment') : badge('prose term')} <code>${escapeXml(entry.concept)}</code>`,
  escapeXml(entry.shape),
  badge(entry.kind),
  entry.alternativeKinds.length === 0
    ? 'no other reading is supported'
    : entry.alternativeKinds.map((kind) => escapeXml(kind)).join(', '),
  escapeXml(entry.rationale),
  entry.requirementIds.length === 0
    ? 'whole specification'
    : entry.requirementIds.map((id) => `<code>${escapeXml(id)}</code>`).join(', '),
  entry.nearestExisting.length === 0
    ? 'nothing close in the index'
    : entry.nearestExisting.map((name) => `<code>${escapeXml(name)}</code>`).join(', '),
  entry.confidence.toFixed(2),
];

/**
 * The absences, as a first-class section rather than a warning nobody reads.
 *
 * "Nearest existing" is the column that stops this from recreating the noise it replaces: those
 * names are reported HERE, as evidence that two vocabularies may differ, and never as impacts —
 * a component whose name resembles a route the repository does not serve is a different component,
 * not a weaker reading of the same one.
 */
export const unresolvedSurfacesTable = (
  surfaces: readonly UnresolvedSurfaceRow[],
): string =>
  section(
    'unresolved-surfaces-heading',
    'Unresolved and new surfaces',
    'Terms the specification names that resolve to no indexed artifact. Each carries the reading the evidence best supports AND the readings that stay open — "nothing matches" is consistent with building it, calling it, indexing the repository that holds it, or renaming the concept, and those are opposite plans. Nothing here was created as a graph node.',
    [
      `<thead>`,
      headerRow([
        'Concept',
        'Written as',
        'Best reading',
        'Still open',
        'What to do',
        'Requirement',
        'Nearest existing (vocabulary, not impacts)',
        'Conf.',
      ]),
      `</thead><tbody>`,
      ...surfaces.map((entry) => row(surfaceCells(entry))),
      `</tbody>`,
    ].join(''),
  );

export const proposedTables = (proposed: ImpactProposedFacts): string =>
  [
    section(
      'proposed-components-heading',
      `Proposed components [${PROPOSED_BADGE}]`,
      `Components an architectural option would CREATE. None of these exists in the repository; they are listed beside the current structure, never merged into it (§3, §18.4).`,
      [
        `<thead>`,
        headerRow(['Name', 'Type', 'Category', 'From option', 'Rationale', 'Provenance', 'Conf.']),
        `</thead><tbody>`,
        ...proposed.nodes.map((node) =>
          row([
            `${badge(PROPOSED_BADGE)} ${escapeXml(node.name)}`,
            escapeXml(node.type),
            escapeXml(node.category),
            `<code>${escapeXml(node.originOptionId)}</code>`,
            escapeXml(node.rationale),
            `${escapeXml(node.provenance)} ${badge(styleFor(node.knowledgeCategory).badge)}`,
            node.confidence.toFixed(2),
          ]),
        ),
        `</tbody>`,
      ].join(''),
    ),
    section(
      'proposed-relationships-heading',
      `Proposed relationships [${PROPOSED_BADGE}]`,
      `Relationships an architectural option would create. Each endpoint says whether it is an existing repository component or itself proposed.`,
      [
        `<thead>`,
        headerRow(['From', 'To', 'Type', 'From option', 'Rationale', 'Provenance', 'Conf.']),
        `</thead><tbody>`,
        ...proposed.relationships.map((edge) =>
          row([
            `<code>${escapeXml(edge.sourceId)}</code> (${escapeXml(edge.sourceKind)})`,
            `<code>${escapeXml(edge.targetId)}</code> (${escapeXml(edge.targetKind)})`,
            `${badge(PROPOSED_BADGE)} ${escapeXml(edge.type)}`,
            `<code>${escapeXml(edge.originOptionId)}</code>`,
            escapeXml(edge.rationale),
            `${escapeXml(edge.provenance)} ${badge(styleFor(edge.knowledgeCategory).badge)}`,
            edge.confidence.toFixed(2),
          ]),
        ),
        `</tbody>`,
      ].join(''),
    ),
  ].join('');
