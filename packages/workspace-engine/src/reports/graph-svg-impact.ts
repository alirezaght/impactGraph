import {
  likelihoodMeter,
  likelihoodText,
  METER_WIDTH,
  PROPOSED_BADGE,
  PROPOSED_DASH,
} from './graph-impact-style.js';
import { styleFor } from './graph-style.js';
import { clip, escapeXml, formatCount, plural } from './graph-text.js';

import type { ImpactNodeFacts } from './graph-impact-model.js';
import type { MemberBox } from './graph-layout-rows.js';
import type { CategoryStyle } from './graph-style.js';

// The impact cell (PRD §18.4/§18.5). Four independent readings, none of them colour:
//
//   BORDER      shape + dash + double outline  → provenance / knowledge category (graph-style.ts)
//   BADGE WORD  FACT / INFERRED / CONFIRMED    → the same, spelled out
//   METER       filled vs hollow segments      → likelihood, the primary signal
//   TEXT        REQUIRED 4/4 · conf 0.88 · indirect · 2 hops
//
// Provenance and likelihood therefore never compete for the same ink, and either one alone is
// enough to read the cell in greyscale.

/** `indirect · 2 hops` — or `direct match` when the traversal took no hops at all. */
export const reachText = (facts: ImpactNodeFacts): string => {
  if (facts.maxHops === 0) {
    return 'direct match';
  }
  const hops =
    facts.minHops === facts.maxHops
      ? plural(facts.maxHops, 'hop')
      : `${formatCount(facts.minHops)}–${plural(facts.maxHops, 'hop')}`;
  return `${facts.directness} · ${hops}`;
};

const attributionText = (facts: ImpactNodeFacts): string => {
  const first = facts.requirementIds[0] ?? 'no requirement';
  return facts.requirementIds.length <= 1
    ? first
    : `${first} +${formatCount(facts.requirementIds.length - 1)}`;
};

/** Hover text: nothing elided, every requirement named, the absence of a path stated. */
export const impactTooltip = (member: MemberBox, style: CategoryStyle): string => {
  const node = member.node;
  const facts = node.impact;
  if (facts === undefined) {
    return `[${PROPOSED_BADGE}] ${node.name} (${node.type}) — does not exist in the repository; provenance ${node.provenance} — ${style.badge}`;
  }
  return [
    `${node.name} (${node.type})`,
    `likelihood: ${likelihoodText(facts.likelihood)}`,
    `confidence: ${facts.confidence.toFixed(2)}`,
    `impact type: ${facts.impactTypes.join(', ')}`,
    `reach: ${reachText(facts)}`,
    `requirements: ${facts.requirementIds.join(', ')}`,
    `provenance: ${node.provenance} — ${style.badge}`,
    node.path === undefined ? 'path: not reported' : `path: ${node.path}`,
    facts.missingFromSnapshot ? 'NOT IN SNAPSHOT: this component is absent from the graph' : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
};

const line = (member: MemberBox, dy: number, className: string, text: string): string =>
  `<text class="${className}" x="${String(member.x + 10)}" y="${String(member.y + dy)}">${escapeXml(text)}</text>`;

/**
 * Absent data reads as absent (§Z5): a component the analysis cites but the graph does not contain
 * says so in the cell, rather than showing a plausible-looking box.
 */
const metaText = (member: MemberBox, style: CategoryStyle): string => {
  const node = member.node;
  const suffix = node.impact?.missingFromSnapshot === true ? ' · NOT IN SNAPSHOT' : '';
  return `${clip(node.type, 14)} · ${style.badge}${suffix}`;
};

export const impactMemberBody = (member: MemberBox): string => {
  const node = member.node;
  const facts = node.impact;
  if (facts === undefined) {
    return proposedMemberBody(member);
  }
  const style = styleFor(node.knowledgeCategory);
  const meterX = member.x + member.width - 10 - METER_WIDTH;
  return [
    line(member, 20, 'member-name', clip(node.name, 26)),
    line(member, 35, 'member-meta', metaText(member, style)),
    likelihoodMeter(facts.likelihood, meterX, member.y + 47),
    line(member, 57, 'member-likelihood', likelihoodText(facts.likelihood)),
    line(member, 72, 'member-meta', `conf ${facts.confidence.toFixed(2)} · ${reachText(facts)}`),
    line(
      member,
      85,
      'member-meta',
      `${clip(facts.impactTypes[0] ?? 'no impact type', 18)} · ${attributionText(facts)}`,
    ),
  ].join('');
};

/** A proposed component: no likelihood (it is not an impact), long-dash border, `[PROPOSED]`. */
const proposedMemberBody = (member: MemberBox): string => {
  const node = member.node;
  const style = styleFor(node.knowledgeCategory);
  return [
    line(member, 20, 'member-name', clip(node.name, 26)),
    line(member, 35, 'member-meta', `${clip(node.type, 14)} · ${style.badge}`),
    line(member, 57, 'member-likelihood', `[${PROPOSED_BADGE}]`),
    line(member, 72, 'member-meta', 'not in the repository'),
  ].join('');
};

/** Border dash for a cell: proposed components override the provenance dash with the long dash. */
export const memberDash = (member: MemberBox, style: CategoryStyle): string => {
  if (member.node.proposed === true) {
    return ` stroke-dasharray="${PROPOSED_DASH}"`;
  }
  return style.dash === 'none' ? '' : ` stroke-dasharray="${style.dash}"`;
};
