import { IMPACT_LIKELIHOODS } from '@impactgraph/domain';

import type { ImpactLikelihood } from '@impactgraph/domain';

// PRD §13 likelihood, encoded so it reads WITHOUT COLOUR — it is the thing a reader acts on.
//
// The export already spends its border geometry on provenance (`graph-style.ts`: corner shape,
// dash pattern, double outline, arrowhead, FACT/INFERRED/CONFIRMED badge). Likelihood therefore
// gets its own, ORTHOGONAL channels so the two never compete for the same ink:
//
//   * a 4-SEGMENT METER drawn inside the cell — filled segments are solid, the rest are hollow
//     outlines, so the reading is a count of shapes, not a shade;
//   * the SPELLED-OUT WORD (`REQUIRED`, `LIKELY`, `POSSIBLE`, `UNLIKELY`) beside it;
//   * the fraction in text (`4/4`), so a screen reader and a greyscale printout both land.
//
// Nothing here emits a colour. `currentColor` and `none` are the only fills in the file.

export interface LikelihoodStyle {
  readonly likelihood: ImpactLikelihood;
  readonly badge: string;
  /** Filled meter segments out of `LIKELIHOOD_SEGMENTS`. The shape channel. */
  readonly filled: number;
  /** 0 = strongest. Drives ordering and which impacts survive the §33 budget. */
  readonly rank: number;
  readonly description: string;
}

export const LIKELIHOOD_SEGMENTS = 4;

const STYLES: Readonly<Record<ImpactLikelihood, LikelihoodStyle>> = {
  required: {
    likelihood: 'required',
    badge: 'REQUIRED',
    filled: 4,
    rank: 0,
    description:
      'Four filled meter segments. The requirement names this component, or cannot be satisfied without changing it.',
  },
  likely: {
    likelihood: 'likely',
    badge: 'LIKELY',
    filled: 3,
    rank: 1,
    description:
      'Three filled segments, one hollow. A close dependency of something the requirement names.',
  },
  possible: {
    likelihood: 'possible',
    badge: 'POSSIBLE',
    filled: 2,
    rank: 2,
    description:
      'Two filled segments, two hollow. Reached by traversal — worth reading before implementing, not a prediction of change.',
  },
  unlikely: {
    likelihood: 'unlikely',
    badge: 'UNLIKELY',
    filled: 1,
    rank: 3,
    description:
      'One filled segment. Reported for completeness so the traversal is auditable; expect no change here.',
  },
};

export const likelihoodStyleFor = (likelihood: ImpactLikelihood): LikelihoodStyle =>
  STYLES[likelihood];

/** Strongest first — the legend order, the table order, and the budget's priority order. */
export const LIKELIHOOD_STYLES: readonly LikelihoodStyle[] =
  IMPACT_LIKELIHOODS.map(likelihoodStyleFor);

export const likelihoodRank = (likelihood: ImpactLikelihood): number =>
  likelihoodStyleFor(likelihood).rank;

/** `REQUIRED 4/4` — the text form, used in tables, tooltips and `aria` descriptions. */
export const likelihoodText = (likelihood: ImpactLikelihood): string => {
  const style = likelihoodStyleFor(likelihood);
  return `${style.badge} ${String(style.filled)}/${String(LIKELIHOOD_SEGMENTS)}`;
};

const SEGMENT_W = 9;
const SEGMENT_H = 9;
const SEGMENT_GAP = 3;

export const METER_WIDTH =
  LIKELIHOOD_SEGMENTS * SEGMENT_W + (LIKELIHOOD_SEGMENTS - 1) * SEGMENT_GAP;

/**
 * The meter itself. One definition, used by the diagram cells AND by the legend swatches, so the
 * legend can never drift from what the diagram draws. `aria-hidden` because every meter is
 * accompanied by its spelled-out word in text.
 */
export const likelihoodMeter = (likelihood: ImpactLikelihood, x: number, y: number): string => {
  const filled = likelihoodStyleFor(likelihood).filled;
  const segments = Array.from({ length: LIKELIHOOD_SEGMENTS }, (_, index) => {
    const className = index < filled ? 'meter-on' : 'meter-off';
    const left = x + index * (SEGMENT_W + SEGMENT_GAP);
    return `<rect class="${className}" x="${String(left)}" y="${String(y)}" width="${String(SEGMENT_W)}" height="${String(SEGMENT_H)}" rx="1" />`;
  });
  return `<g class="meter" aria-hidden="true">${segments.join('')}</g>`;
};

// --- §18.4 current vs proposed -----------------------------------------------------------------
//
// The webview marks a proposed relationship with a LONG dash no current treatment can produce, a
// source arrowhead no current edge draws, and the word `[PROPOSED]` in its label
// (apps/vscode-extension/webview/src/graph/style.ts). This export mirrors all three, which leaves
// provenance in full possession of its own channels: the target arrowhead and the text badge still
// say FACT vs INFERRED vs CONFIRMED on a proposed edge.

export const PROPOSED_BADGE = 'PROPOSED';

/** Longer than any provenance dash (`7 5`, `2 4`, `1 3 8 3`), so the two never read alike. */
export const PROPOSED_DASH = '14 6';

/** Source-end marker id. No current edge draws a marker-start at all. */
export const PROPOSED_SOURCE_MARKER = 'arrow-proposed-source';
