import { MARKER_IDS, markerElement, styleFor } from './graph-style.js';
import { clip, escapeXml, formatCount } from './graph-text.js';

import type { EdgePath, GraphLayout, GroupBox, MemberBox } from './graph-layout.js';
import type { CategoryStyle } from './graph-style.js';
import type { GraphView } from './graph-view-model.js';

// Inline SVG only — no <script>, no <image>, no external font, no remote reference of any kind.
// Browsers zoom and pan SVG natively, so no interaction code is needed to explore the diagram.

const defs = (): string =>
  `<defs>${MARKER_IDS.map((marker) => markerElement(marker)).join('')}</defs>`;

/** Border geometry for one category — the shape + stroke half of the §3 encoding. */
const outline = (
  box: { x: number; y: number; width: number; height: number },
  style: CategoryStyle,
  className: string,
): string => {
  const dash = style.dash === 'none' ? '' : ` stroke-dasharray="${style.dash}"`;
  const base = `<rect class="${className}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${style.radius}" stroke-width="${style.strokeWidth}"${dash} />`;
  if (!style.doubleOutline) {
    return base;
  }
  const inset = 3;
  return `${base}<rect class="${className} inner" x="${box.x + inset}" y="${box.y + inset}" width="${Math.max(0, box.width - 2 * inset)}" height="${Math.max(0, box.height - 2 * inset)}" rx="${Math.max(0, style.radius - 1)}" stroke-width="1" fill="none" />`;
};

const memberSvg = (member: MemberBox): string => {
  const node = member.node;
  const style = styleFor(node.knowledgeCategory);
  const tooltip = [
    `${node.name} (${node.type})`,
    node.path === undefined ? undefined : `path: ${node.path}`,
    `provenance: ${node.provenance} — ${style.badge}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
  return [
    `<g class="member">`,
    `<title>${escapeXml(tooltip)}</title>`,
    outline(member, style, 'node-shape'),
    `<text class="member-name" x="${member.x + 10}" y="${member.y + 21}">${escapeXml(clip(node.name, 24))}</text>`,
    `<text class="member-meta" x="${member.x + 10}" y="${member.y + 38}">${escapeXml(clip(node.type, 16))} · ${style.badge}</text>`,
    `</g>`,
  ].join('');
};

const groupHeadline = (box: GroupBox): string => {
  const group = box.group;
  const parts = [`${formatCount(group.totalNodes)} nodes`];
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

const groupSvg = (box: GroupBox): string =>
  [
    `<g class="group">`,
    `<title>${escapeXml(`${box.group.label} — ${groupHeadline(box)}`)}</title>`,
    `<rect class="group-shape" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" />`,
    `<text class="group-label" x="${box.x + 14}" y="${box.y + 27}">${escapeXml(clip(box.group.label, 42))}</text>`,
    `<text class="group-meta" x="${box.x + 14}" y="${box.y + 47}">${escapeXml(clip(groupHeadline(box), 58))}</text>`,
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
  return `${head}${more} · ${styleFor(path.edge.knowledgeCategory).badge}`;
};

/** Hover text: nothing elided. */
const edgeTooltipText = (path: EdgePath): string =>
  `${path.edge.sourceGroupId} → ${path.edge.targetGroupId}: ${path.edge.kinds.map(kindText).join(', ')} · ${styleFor(path.edge.knowledgeCategory).badge}`;

const edgeSvg = (path: EdgePath): string => {
  const style = styleFor(path.edge.knowledgeCategory);
  const dash = style.dash === 'none' ? '' : ` stroke-dasharray="${style.dash}"`;
  const label = clip(edgeLabelText(path), 34);
  const width = label.length * 6 + 12;
  const tooltip = edgeTooltipText(path);
  return [
    `<g class="edge">`,
    `<title>${escapeXml(tooltip)}</title>`,
    `<path class="edge-line" d="${path.path}" marker-end="url(#${style.marker})"${dash} />`,
    `<rect class="edge-label-bg" x="${path.labelX - Math.round(width / 2)}" y="${path.labelY - 10}" width="${width}" height="17" rx="4" />`,
    `<text class="edge-label" x="${path.labelX}" y="${path.labelY + 2}">${escapeXml(label)}</text>`,
    `</g>`,
  ].join('');
};

export const renderGraphSvg = (view: GraphView, layout: GraphLayout): string =>
  [
    `<svg class="diagram" role="img" aria-labelledby="diagram-title diagram-desc"`,
    // No `xmlns`: the SVG is inline in an HTML document, where the parser already places it in
    // the SVG namespace. Omitting it also keeps the file free of any URL-shaped string at all.
    ` viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">`,
    `<title id="diagram-title">Architecture diagram grouped by ${escapeXml(view.grouping)}</title>`,
    `<desc id="diagram-desc">${escapeXml(
      `${formatCount(view.groups.length)} groups, ${formatCount(view.nodes.length)} drawn component nodes and ${formatCount(view.edges.length)} aggregated relationships. The same information is listed in the tables below this diagram.`,
    )}</desc>`,
    defs(),
    `<g class="edges">${layout.edges.map(edgeSvg).join('')}</g>`,
    `<g class="groups">${layout.groups.map(groupSvg).join('')}</g>`,
    `</svg>`,
  ].join('');
