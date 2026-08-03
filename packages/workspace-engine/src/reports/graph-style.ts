import { RENDER_CATEGORIES } from './graph-view-model.js';

import type { RenderCategory } from './graph-view-model.js';

// PRD §3 + §37 — the visual system for the three knowledge categories, expressed so that it
// survives greyscale printing, colour-blind viewers and monochrome terminals-turned-PDF:
//
//   * SHAPE          square corners vs rounded vs double-outlined vs notched
//   * BORDER STROKE  solid vs dashed vs dash-dot vs dotted
//   * TEXT BADGE     FACT / INFERRED / CONFIRMED / RESERVED / UNKNOWN, spelled out on every node
//   * ARROWHEAD      filled triangle vs hollow triangle vs filled diamond vs bar vs open chevron
//
// Colour is NOT part of the encoding. The whole export is rendered in `currentColor` and greys,
// so nothing in it can be read only by hue.

export interface CategoryStyle {
  readonly category: RenderCategory;
  /** The short text badge stamped on every node and every relationship label. */
  readonly badge: string;
  readonly label: string;
  /** Corner radius — the shape channel. 0 = square, 12 = rounded. */
  readonly radius: number;
  /** `stroke-dasharray` value, or 'none'. The stroke channel. */
  readonly dash: string;
  readonly strokeWidth: number;
  /** Draw a second, inset outline (the "double border" of human-confirmed knowledge). */
  readonly doubleOutline: boolean;
  /** Arrowhead marker id — the shape channel for relationship provenance and direction. */
  readonly marker: string;
  readonly description: string;
}

const STYLES: Readonly<Record<RenderCategory, CategoryStyle>> = {
  deterministic: {
    category: 'deterministic',
    badge: 'FACT',
    label: 'Deterministic fact',
    radius: 0,
    dash: 'none',
    strokeWidth: 2,
    doubleOutline: false,
    marker: 'arrow-fact',
    description:
      'Square corners, solid border, filled triangular arrowhead. Read directly from the repository by static analysis, configuration, git history or a framework convention.',
  },
  'ai-inferred': {
    category: 'ai-inferred',
    badge: 'INFERRED',
    label: 'AI-inferred interpretation',
    radius: 12,
    dash: '7 5',
    strokeWidth: 2,
    doubleOutline: false,
    marker: 'arrow-inferred',
    description:
      'Rounded corners, dashed border, hollow triangular arrowhead. A model’s interpretation — never promoted to fact, and never authoritative.',
  },
  'human-confirmed': {
    category: 'human-confirmed',
    badge: 'CONFIRMED',
    label: 'Human-confirmed knowledge',
    radius: 4,
    dash: 'none',
    strokeWidth: 2,
    doubleOutline: true,
    marker: 'arrow-confirmed',
    description:
      'Double outline, solid border, filled diamond arrowhead. Committed by a person; it supersedes prior knowledge without rewriting it.',
  },
  reserved: {
    category: 'reserved',
    badge: 'RESERVED',
    label: 'Reserved provenance',
    radius: 12,
    dash: '2 4',
    strokeWidth: 2,
    doubleOutline: false,
    marker: 'arrow-reserved',
    description:
      'Dotted border, bar terminator. Reserved for runtime observation; no current code path produces it, so seeing one is a bug.',
  },
  unknown: {
    category: 'unknown',
    badge: 'UNKNOWN',
    label: 'Unrecognized provenance',
    radius: 0,
    dash: '1 3 8 3',
    strokeWidth: 2,
    doubleOutline: false,
    marker: 'arrow-unknown',
    description:
      'Dash-dot border, open chevron. The provenance string is not one this build recognizes — shown as unknown rather than assumed to be a fact (§43.6).',
  },
};

export const styleFor = (category: RenderCategory): CategoryStyle => STYLES[category];

/**
 * Arrowhead geometry per marker id. One definition, reused by the diagram and by the legend
 * swatches, so the legend can never drift from what the diagram actually draws.
 */
const MARKER_SHAPES: Readonly<Record<string, string>> = {
  'arrow-fact': '<path d="M 0 0 L 10 4 L 0 8 z" fill="currentColor" />',
  'arrow-inferred':
    '<path d="M 1 1 L 9 4 L 1 7 z" fill="none" stroke="currentColor" stroke-width="1.4" />',
  'arrow-confirmed': '<path d="M 0 4 L 5 0 L 10 4 L 5 8 z" fill="currentColor" />',
  'arrow-reserved': '<rect x="6" y="0.5" width="2.5" height="7" fill="currentColor" />',
  'arrow-unknown':
    '<path d="M 1 0.5 L 8 4 L 1 7.5" fill="none" stroke="currentColor" stroke-width="1.4" />',
  // §18.4 proposed structure: a SOURCE-end marker. No current relationship draws one, so its mere
  // presence separates proposed from current without touching the provenance channels.
  'arrow-proposed-source':
    '<path d="M 0 4 L 5 0 L 10 4 L 5 8 z" fill="none" stroke="currentColor" stroke-width="1.4" />',
};

export const MARKER_IDS: readonly string[] = Object.keys(MARKER_SHAPES);

export const markerShape = (marker: string): string => MARKER_SHAPES[marker] ?? '';

/** `<marker>` element for an arrowhead. `idPrefix` keeps legend swatches from colliding. */
export const markerElement = (marker: string, idPrefix = ''): string =>
  `<marker id="${idPrefix}${marker}" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto-start-reverse">${markerShape(marker)}</marker>`;

/** Legend order: the three real categories first, then the two exception cases. */
export const CATEGORY_STYLES: readonly CategoryStyle[] = RENDER_CATEGORIES.map(styleFor);
