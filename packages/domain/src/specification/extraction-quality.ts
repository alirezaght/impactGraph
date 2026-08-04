import { validationIssue } from '../errors/validation.js';

import type { ValidationIssue } from '../errors/validation.js';

/**
 * How the requirements of a specification were obtained (trial finding: "Explicit numbered
 * requirements were ignored and prose was sentence-split into dozens of fake requirements").
 *
 * The distinction is not cosmetic. A specification that states R1–R7 has an author-declared
 * requirement list, and an analysis over it can be trusted to be about those seven things. A
 * specification that had to be sentence-split has no such list, and the "requirements" are the
 * extractor's guesses — every downstream number computed from them (coverage, readiness,
 * unmatched counts) measures the guess, not the specification. That has to be visible.
 */
export const EXTRACTION_STRATEGIES = [
  /** Every requirement came from an explicit list, labels, acceptance criteria, or tasks. */
  'structured',
  /** Structured content existed but part of the specification still needed prose splitting. */
  'partially-structured',
  /** No structured content at all — the whole specification was sentence-split. */
  'prose-fallback',
] as const;

export type ExtractionStrategy = (typeof EXTRACTION_STRATEGIES)[number];

export interface ExtractionQuality {
  readonly strategy: ExtractionStrategy;
  readonly structuredRequirementCount: number;
  readonly proseRequirementCount: number;
  /** Headings recognized as structural, verbatim — so a reader can audit the classification. */
  readonly recognizedSections: readonly string[];
  /**
   * True when the requirement list is the extractor's guess rather than the author's. Every
   * artifact derived from such an extraction is marked provisional and readiness is withheld:
   * scoring the implementability of invented requirements is worse than reporting nothing.
   */
  readonly provisional: boolean;
  /** Prominent, user-facing reasons the extraction is what it is. Never silent. */
  readonly warnings: readonly string[];
}

export const extractionQualityIssues = (
  quality: ExtractionQuality,
  path: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!(EXTRACTION_STRATEGIES as readonly string[]).includes(quality.strategy)) {
    issues.push(
      validationIssue('invalid-type', `${path}.strategy`, `unknown strategy '${quality.strategy}'`),
    );
  }
  for (const [field, value] of [
    ['structuredRequirementCount', quality.structuredRequirementCount],
    ['proseRequirementCount', quality.proseRequirementCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      issues.push(validationIssue('out-of-range', `${path}.${field}`, 'must be an integer >= 0'));
    }
  }
  return issues;
};

/**
 * The strategy implied by the counts. A single structured requirement is enough to prove the
 * author declared a list; anything additional that had to be split is reported as partial rather
 * than allowed to downgrade the whole extraction.
 */
export const strategyFor = (structured: number, prose: number): ExtractionStrategy => {
  if (structured === 0) {
    return 'prose-fallback';
  }
  return prose === 0 ? 'structured' : 'partially-structured';
};

/**
 * How many prose-derived requirements the extractor may produce before the extraction is called
 * provisional.
 *
 * The failure the trials exposed is INFLATION: a page of prose became dozens of "requirements", and
 * every count computed from them — coverage, readiness, unmatched — measured the inflation. A
 * one-line specification under a title has the same strategy but not the same problem: there is one
 * statement, the extractor cut it at the only boundary available, and withholding readiness over
 * that would degrade the tool for the commonest input there is.
 *
 * So the strategy is always reported honestly, and `provisional` — which withholds readiness and
 * taints the analysis — trips only once the guess is load-bearing.
 */
export const PROSE_PROVISIONAL_THRESHOLD = 3;

export const isProvisional = (structured: number, prose: number): boolean =>
  structured === 0 && prose > PROSE_PROVISIONAL_THRESHOLD;
