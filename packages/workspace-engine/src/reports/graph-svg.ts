import { PROPOSED_BADGE, PROPOSED_DASH, PROPOSED_SOURCE_MARKER } from './graph-impact-style.js';
import { MARKER_IDS, markerElement, styleFor } from './graph-style.js';
import { impactMemberBody, impactTooltip, memberDash } from './graph-svg-impact.js';
import { clip, escapeXml, formatCount } from './graph-text.js';

import type { EdgePath, GraphLayout, GroupBox, MemberBox } from './graph-layout.js';
import type { CategoryStyle } from './graph-style.js';
import type { GraphView, GraphViewKind } from './graph-view-model.js';

// Inline SVG only — no <script>, no <image>, no external font, no remote reference of any kind.
// Browsers zoom and pan SVG natively, so no interaction code is needed to explore the diagram.
//
// One emitter for both view sources. The cell CONTENTS differ (an impact cell adds a likelihood
// meter, a confidence figure and a hop count), so the cell body is chosen by whether the node
// carries impact facts; everything else — outlines, groups, edges, markers — is shared.

const defs = (): string =>
  `<defs>${MARKER_IDS.map((marker) => markerElement(marker)).join('')}</defs>`;

/** Border geometry for one category — the shape + stroke half of the §3 encoding. */
const outline = (
  box: { x: number; y: number; width: number; height: number },
  style: CategoryStyle,
  className: string,
  dash: string,
): string => {
  const base = `<rect class="${className}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${style.radius}" stroke-width="${style.strokeWidth}"${dash} />`;
  if (!style.doubleOutline) {
    return base;
  }
  const inset = 3;
  return `${base}<rect class="${className} inner" x="${box.x + inset}" y="${box.y + inset}" width="${Math.max(0, box.width - 2 * inset)}" height="${Math.max(0, box.height - 2 * inset)}" rx="${Math.max(0, style.radius - 1)}" stroke-width="1" fill="none" />`;
};

/** The architecture cell body: name, type and the provenance badge. */
const architectureMemberBody = (member: MemberBox, style: CategoryStyle): string => {
  const node = member.node;
  return [
    `<text class="member-name" x="${member.x + 10}" y="${member.y + 21}">${escapeXml(clip(node.name, 24))}</text>`,
    `<text class="member-meta" x="${member.x + 10}" y="${member.y + 38}">${escapeXml(clip(node.type, 16))} · ${style.badge}</text>`,
  ].join('');
};

const architectureTooltip = (member: MemberBox, style: CategoryStyle): string => {
  const node = member.node;
  return [
    `${node.name} (${node.type})`,
    node.path === undefined ? undefined : `path: ${node.path}`,
    `provenance: ${node.provenance} — ${style.badge}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
};

/**
 * `<title>` stays the FIRST child of its `<g>`: assistive technology takes the first title child as
 * the accessible name, so its position is not merely cosmetic (§37).
 */
const memberSvg = (member: MemberBox): string => {
  const node = member.node;
  const style = styleFor(node.knowledgeCategory);
  const impactCell = node.impact !== undefined || node.proposed === true;
  return [
    `<g class="${node.proposed === true ? 'member proposed' : 'member'}">`,
    `<title>${escapeXml(impactCell ? impactTooltip(member, style) : architectureTooltip(member, style))}</title>`,
    outline(member, style, 'node-shape', memberDash(member, style)),
    impactCell ? impactMemberBody(member) : architectureMemberBody(member, style),
    `</g>`,
  ].join('');
};

/** `12 impacted · 12 drawn · FACT 12` — the noun changes with the view, the counts do not. */
const groupHeadline = (box: GroupBox, kind: GraphViewKind): string => {
  const group = box.group;
  const noun = kind === 'impact' ? 'impacted' : 'nodes';
  const parts = [`${formatCount(group.totalNodes)} ${noun}`];
  if (group.shownNodes > 0 || group.hiddenNodes > 0) {
    parts.push(`${formatCount(group.shownNodes)} drawn`);
  }
  for (const [category, count] of Object.entries(group.countsByKnowledgeCategory)) {
    if (count > 0) {
      parts.push(`${styleFor(category as never).badge} ${formatCount(count)}`);
    }
  }
  return parts.join(' · ');
};

const groupSvg = (box: GroupBox, kind: GraphViewKind): string =>
  [
    `<g class="group">`,
    `<title>${escapeXml(`${box.group.label} — ${groupHeadline(box, kind)}`)}</title>`,
    `<rect class="group-shape" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" />`,
    `<text class="group-label" x="${box.x + 14}" y="${box.y + 27}">${escapeXml(clip(box.group.label, 42))}</text>`,
    `<text class="group-meta" x="${box.x + 14}" y="${box.y + 47}">${escapeXml(clip(groupHeadline(box, kind), 58))}</text>`,
    ...box.members.map(memberSvg),
    `</g>`,
  ].join('');

const kindText = (kind: { type: string; count: number }): string =>
  `${kind.type} ×${formatCount(kind.count)}`;

/**
 * On-canvas label: the dominant relationship type plus `+n` for the rest. A dense architecture
 * produces dozens of arrows, and spelling every type out turns the diagram into overlapping text.
 * The full breakdown is one hover away and is spelled out in full in the Relationships table.
 */
export const edgeLabelText = (path: EdgePath): string => {
  const [first, ...rest] = path.edge.kinds;
  const head = first === undefined ? `×${formatCount(path.edge.count)}` : kindText(first);
  const more = rest.length === 0 ? '' : ` +${String(rest.length)}`;
  const proposed = path.edge.status === 'proposed' ? `[${PROPOSED_BADGE}] ` : '';
  return `${proposed}${head}${more} · ${styleFor(path.edge.knowledgeCategory).badge}`;
};

/** Hover text: nothing elided. */
const edgeTooltipText = (path: EdgePath): string => {
  const proposed =
    path.edge.status === 'proposed'
      ? `[${PROPOSED_BADGE}] would be created — not a current relationship: `
      : '';
  return `${proposed}${path.edge.sourceGroupId} → ${path.edge.targetGroupId}: ${path.edge.kinds.map(kindText).join(', ')} · ${styleFor(path.edge.knowledgeCategory).badge}`;
};

/**
 * §18.4 proposed treatment, mirroring the webview: a LONG dash no provenance dash can produce, a
 * SOURCE-end marker no current edge draws at all, and `[PROPOSED]` in the label. Provenance keeps
 * its own channels — the target arrowhead and the badge word still say FACT vs INFERRED.
 */
const edgeSvg = (path: EdgePath): string => {
  const style = styleFor(path.edge.knowledgeCategory);
  const proposed = path.edge.status === 'proposed';
  const dashValue = proposed ? PROPOSED_DASH : style.dash;
  const dash = dashValue === 'none' ? '' : ` stroke-dasharray="${dashValue}"`;
  const start = proposed ? ` marker-start="url(#${PROPOSED_SOURCE_MARKER})"` : '';
  const label = clip(edgeLabelText(path), 40);
  const width = label.length * 6 + 12;
  return [
    `<g class="edge${proposed ? ' proposed' : ''}">`,
    `<title>${escapeXml(edgeTooltipText(path))}</title>`,
    `<path class="edge-line" d="${path.path}" marker-end="url(#${style.marker})"${start}${dash} />`,
    `<rect class="edge-label-bg" x="${path.labelX - Math.round(width / 2)}" y="${path.labelY - 10}" width="${width}" height="17" rx="4" />`,
    `<text class="edge-label" x="${path.labelX}" y="${path.labelY + 2}">${escapeXml(label)}</text>`,
    `</g>`,
  ].join('');
};

const diagramTitle = (view: GraphView): string =>
  view.kind === 'impact'
    ? `Impact diagram: components a specification is predicted to touch, grouped by ${view.grouping}`
    : `Architecture diagram grouped by ${view.grouping}`;

const diagramDescription = (view: GraphView): string => {
  const shared = `${formatCount(view.groups.length)} groups, ${formatCount(view.nodes.length)} drawn component nodes and ${formatCount(view.edges.length)} aggregated relationships. The same information is listed in the tables below this diagram.`;
  return view.kind === 'impact'
    ? `${shared} Each component box states its likelihood in words and as a four-segment meter, its confidence as a number, and how many dependency hops away it is.`
    : shared;
};

export const renderGraphSvg = (view: GraphView, layout: GraphLayout): string =>
  [
    `<svg class="diagram" role="img" aria-labelledby="diagram-title diagram-desc"`,
    // No `xmlns`: the SVG is inline in an HTML document, where the parser already places it in
    // the SVG namespace. Omitting it also keeps the file free of any URL-shaped string at all.
    ` viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">`,
    `<title id="diagram-title">${escapeXml(diagramTitle(view))}</title>`,
    `<desc id="diagram-desc">${escapeXml(diagramDescription(view))}</desc>`,
    defs(),
    `<g class="edges">${layout.edges.map(edgeSvg).join('')}</g>`,
    `<g class="groups">${layout.groups.map((box) => groupSvg(box, view.kind)).join('')}</g>`,
    `</svg>`,
  ].join('');
