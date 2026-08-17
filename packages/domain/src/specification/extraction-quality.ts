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
  /**
   * No structured list, but the prose carried normative statements (must/should/shall/imperative)
   * the per-statement classifier admitted — a legitimate design-doc specification, not a guess.
   */
  'prose-modal',
  /** No structured content and no normative prose — nothing admissible was found. */
  'prose-fallback',
] as const;

export type ExtractionStrategy = (typeof EXTRACTION_STRATEGIES)[number];

export interface ExtractionQuality {
  readonly strategy: ExtractionStrategy;
  readonly structuredRequirementCount: number;
  readonly proseRequirementCount: number;
  /**
   * Prose sentences the classifier could not decide about — routed to open questions instead of
   * being invented as requirements. Additive: absent on artifacts stored before graduated
   * extraction existed, which is not the same claim as a measured zero.
   */
  readonly uncertainStatementCount?: number;
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
    ['uncertainStatementCount', quality.uncertainStatementCount],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      issues.push(validationIssue('out-of-range', `${path}.${field}`, 'must be an integer >= 0'));
    }
  }
  return issues;
};

/**
 * The strategy implied by the counts. A single structured requirement is enough to prove the
 * author declared a list; anything additional that had to be split is reported as partial rather
 * than allowed to downgrade the whole extraction. Without a list, the strategy is `prose-modal`
 * as soon as the classifier admitted at least one normative statement — the document specified
 * behavior in prose, which is how real design docs are written.
 */
export const strategyFor = (
  structured: number,
  proseModal: number,
  proseFallback = 0,
): ExtractionStrategy => {
  if (structured > 0) {
    return proseModal + proseFallback === 0 ? 'structured' : 'partially-structured';
  }
  return proseModal > 0 ? 'prose-modal' : 'prose-fallback';
};

/**
 * How many UNCERTAIN prose statements the classifier may find before the extraction is called
 * provisional.
 *
 * Two failures shaped this rule. The trials exposed INFLATION: a page of prose became dozens of
 * "requirements", and every count computed from them measured the inflation. Field feedback then
 * exposed the over-correction: a normal design doc whose Goals prose was full of "must"/"should"
 * statements was still marked PROVISIONAL, readiness withheld, its author told to reformat.
 *
 * So provisionality now measures the guesswork, not the format: a document whose prose is mostly
 * requirement-grade modal statements is a specification and readiness stands. Provisional trips
 * only when the classifier found mostly uncertain sentences (little modal signal) AND the
 * uncertainty is load-bearing — a one-line note under a title still gets a score.
 */
export const PROSE_PROVISIONAL_THRESHOLD = 3;

export const isProvisional = (structured: number, proseModal: number, uncertain: number): boolean =>
  structured === 0 && uncertain > proseModal && uncertain > PROSE_PROVISIONAL_THRESHOLD;
