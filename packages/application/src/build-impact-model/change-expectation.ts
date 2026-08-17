/**
 * What the plan expects to HAPPEN at a surface, read from explicit specification wording
 * (ADR-0022) — never from semantic judgment about what the change "probably" means.
 *
 * The cost of the two mistakes is asymmetric. Marking a surface `reuse-unchanged` when the author
 * meant to change it hides a genuinely missing requirement from review; leaving it `must-change`
 * only reproduces today's behaviour. So the wording must be explicit AND must govern the concept
 * this impact is anchored on: a requirement that reuses one component while changing another marks
 * only the component the reuse clause names.
 */

import { SUBJECT_PATTERNS } from '../analyze-specification/no-change-language.js';

import type { NoChangeExpectation } from '../analyze-specification/no-change-language.js';

export type ChangeExpectationCue = {
  readonly expectation: NoChangeExpectation | 'preserve';
  /** The wording that produced this reading, quoted so the classification is auditable. */
  readonly cue: string;
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * True when the reuse clause's subject names this concept. Compared on normalized text so
 * `DigestRenderer`, `digest-renderer` and `digest_renderer` are one name; a path subject matches
 * when the concept is its basename, which is how specifications refer back to a file.
 */
const governs = (subject: string, conceptNames: readonly string[]): boolean => {
  const normalizedSubject = normalize(subject);
  const basename = normalize(subject.slice(subject.lastIndexOf('/') + 1));
  return conceptNames.some((concept) => {
    const normalizedConcept = normalize(concept);
    if (normalizedConcept.length < 3) {
      return false;
    }
    return (
      normalizedConcept === normalizedSubject ||
      normalizedConcept === basename ||
      normalize(concept.slice(concept.lastIndexOf('/') + 1)) === basename
    );
  });
};

/**
 * The expectation this statement sets for a surface anchored on `conceptNames`, or undefined when
 * the statement says nothing explicit about it — the safe default, read as `must-change`.
 *
 * This reads DESIGN CHOICES only (planned reuse, verification). A regression boundary rides on the
 * requirement's `intent` instead: it is a property of the requirement, not a clause the reader has
 * to re-derive per candidate, and its protected surface is often a phrase this subject grammar
 * cannot capture ("existing lookup behaviour").
 */
export const changeExpectationFor = (
  statement: string,
  conceptNames: readonly string[],
): ChangeExpectationCue | undefined => {
  if (conceptNames.length === 0) {
    return undefined;
  }
  for (const { pattern, expectation } of SUBJECT_PATTERNS) {
    const match = pattern.exec(statement);
    const subject = match?.[1];
    if (match !== null && subject !== undefined && governs(subject, conceptNames)) {
      return { expectation, cue: match[0].trim() };
    }
  }
  return undefined;
};
