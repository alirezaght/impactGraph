import { likelihoodRank } from './evidence-basis.js';

import type { ImpactEvidenceType } from './evidence-basis.js';
import type { ImpactLikelihood } from './impact-analysis.js';

/**
 * Evidence-quality verdict over the impacts a view actually shows (dogfooding item 4).
 *
 * `counts.byLikelihood` and `counts.byEvidenceType` state the distribution, but nothing
 * interpreted them: a default view where every finding is a fuzzy name match read exactly like one
 * anchored on structural evidence, and a reader had to reverse-engineer the difference. Like
 * {@link assessCoverageSufficiency}, this is deterministic knowledge derived from stored facts —
 * status plus human-readable reasons — and never model-authored.
 */

export type EvidenceQualityStatus = 'evidence-backed' | 'mixed' | 'weak';

/** The facts of one SHOWN impact — computed by the caller from the selected (default-view) set. */
export interface ShownImpactFact {
  readonly likelihood: ImpactLikelihood;
  readonly primaryBasis: ImpactEvidenceType;
  /** Propagating hops from the component the specification named. 0 = the anchor itself. */
  readonly hops: number;
  readonly tierCapped: boolean;
}

export interface EvidenceQualityCounts {
  readonly shownImpactCount: number;
  /** Shown impacts at `required` or `likely` — the tiers a reader acts on. */
  readonly strongTierCount: number;
  /** Strong-tier impacts whose primary basis is structural (not a name or meaning match). */
  readonly strongTierStructuralCount: number;
  /** Shown impacts whose primary basis is deterministic fuzzy name similarity. */
  readonly fuzzyAnchorCount: number;
  /** Shown impacts reached over two or more propagating hops. */
  readonly multiHopCount: number;
  /** Shown impacts whose tier was capped because the basis did not support the proposed tier. */
  readonly tierCappedCount: number;
}

export interface EvidenceQualityVerdict {
  readonly status: EvidenceQualityStatus;
  readonly reasons: readonly string[];
  readonly counts: EvidenceQualityCounts;
}

/** Bases that assert only a naming or meaning resemblance — no traversed relationship. */
const HEURISTIC_BASES: ReadonlySet<ImpactEvidenceType> = new Set([
  'name-similarity',
  'semantic-match',
  'lexical-only',
]);

const STRONG_TIER_CEILING = likelihoodRank('likely');

const isStrongTier = (fact: ShownImpactFact): boolean =>
  likelihoodRank(fact.likelihood) <= STRONG_TIER_CEILING;

const countFacts = (shown: readonly ShownImpactFact[]): EvidenceQualityCounts => ({
  shownImpactCount: shown.length,
  strongTierCount: shown.filter(isStrongTier).length,
  strongTierStructuralCount: shown.filter(
    (fact) => isStrongTier(fact) && !HEURISTIC_BASES.has(fact.primaryBasis),
  ).length,
  fuzzyAnchorCount: shown.filter((fact) => fact.primaryBasis === 'name-similarity').length,
  multiHopCount: shown.filter((fact) => fact.hops >= 2).length,
  tierCappedCount: shown.filter((fact) => fact.tierCapped).length,
});

const n = (value: number): string => String(value);

/**
 * Thresholds, and why each is where it is:
 *
 * - **weak** ⇔ `strongTierStructuralCount === 0` (over a non-empty view). The feedback item is
 *   "the strongest tiers should contain only evidence-backed architectural candidates" — so the
 *   verdict hinges on whether ANY required/likely impact rests on a traversed relationship. One
 *   structurally-backed strong finding anchors the view; zero means every actionable line is a
 *   guess (or nothing reached an actionable tier at all), and the reader must be told either way.
 * - **majority** = strictly more than half. "Most returned impacts are weak or lexical" is a
 *   statement about the typical line a reader sees; exactly half does not make the weak kind
 *   typical, so 0.5 itself does not fire.
 * - **tier caps** are reported at any count > 0 but never make the verdict weak on their own: a
 *   cap is the system working (an over-claim was held down), worth a note, not an alarm.
 *
 * An empty view is `evidence-backed` with no reasons: nothing shown can overstate, and emptiness
 * is the coverage verdict's job, not this one's.
 */
export const assessEvidenceQuality = (
  shown: readonly ShownImpactFact[],
): EvidenceQualityVerdict => {
  const counts = countFacts(shown);
  if (counts.shownImpactCount === 0) {
    return { status: 'evidence-backed', reasons: [], counts };
  }
  const reasons: string[] = [];
  if (counts.strongTierCount === 0) {
    reasons.push(
      `None of the ${n(counts.shownImpactCount)} impacts shown reached required or likely — everything in this view is speculative.`,
    );
  } else if (counts.strongTierStructuralCount === 0) {
    reasons.push(
      `None of the ${n(counts.strongTierCount)} required/likely impacts rests on structural evidence — the strongest findings are name or meaning matches.`,
    );
  }
  if (counts.fuzzyAnchorCount * 2 > counts.shownImpactCount) {
    reasons.push(
      `${n(counts.fuzzyAnchorCount)} of ${n(counts.shownImpactCount)} shown impacts were matched by fuzzy name similarity rather than an exact identifier or alias — confirm the component names before acting on them.`,
    );
  }
  if (counts.multiHopCount * 2 > counts.shownImpactCount) {
    reasons.push(
      `${n(counts.multiHopCount)} of ${n(counts.shownImpactCount)} shown impacts are two or more propagating hops from anything the specification named.`,
    );
  }
  if (counts.tierCappedCount > 0) {
    reasons.push(
      `The tier was capped for ${n(counts.tierCappedCount)} impact(s) whose evidence basis did not support the proposed tier.`,
    );
  }
  const status: EvidenceQualityStatus =
    counts.strongTierStructuralCount === 0
      ? 'weak'
      : reasons.length > 0
        ? 'mixed'
        : 'evidence-backed';
  return { status, reasons, counts };
};
