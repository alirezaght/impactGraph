/**
 * The one place that knows how a specification says "this must not change".
 *
 * Two consumers read the same vocabulary for two different questions, and they were about to grow
 * two different answers to it:
 *
 * - the impact engine asks "does this clause govern THIS component?", so it needs the subject the
 *   clause names (`SUBJECT_PATTERNS`, consumed by build-impact-model/change-expectation.ts);
 * - the requirement extractor asks "is this sentence a regression boundary at all?", which is true
 *   whether or not the protected surface is a name any matcher can resolve (`guardCueOf`).
 *
 * The distinction the wording carries is real and load-bearing. "Reuse the existing renderer" is a
 * DESIGN CHOICE about how to build the change; "the send job must not change behavior" is a
 * REQUIREMENT about what the change must not break. Both predict no diff; only the second one is
 * violated when a diff appears. Pure: no I/O, no clock.
 */

import { conceptsOf } from './statement-analysis.js';

import type { ExtractedQuestionDraft } from './extraction-types.js';

export type NoChangeExpectation = 'reuse-unchanged' | 'verify-only';

export interface SubjectPattern {
  /** Capture group 1 is the subject the clause governs. */
  readonly pattern: RegExp;
  readonly expectation: NoChangeExpectation;
}

/**
 * Each pattern captures the clause AND the subject it governs, so the subject can be matched
 * against an impact's concept. `SUBJECT` is deliberately narrow: an identifier-ish run of words,
 * optionally backticked or quoted, immediately adjacent to the clause.
 */
const SUBJECT = String.raw`\s+(?:the\s+)?(?:existing\s+|current\s+)?[\`'"]?([\w./-]+)[\`'"]?`;

/** Words a specification uses for "the same as it is now". */
const UNCHANGED = String.raw`unchanged|untouched|as-is|as is|intact|the same`;

export const SUBJECT_PATTERNS: readonly SubjectPattern[] = [
  // "reuse X", "re-use the existing X", "keep using X", "continue to use X"
  {
    pattern: new RegExp(
      String.raw`\b(?:re-?use|keep using|continue(?:s|d)? (?:to use|using))${SUBJECT}`,
      'i',
    ),
    expectation: 'reuse-unchanged',
  },
  // "X without modification/changes", "X is unchanged", "X remains unchanged", "X stays as-is"
  {
    pattern: new RegExp(
      String.raw`[\`'"]?([\w./-]+)[\`'"]?\s+(?:is|are|remains?|stays?)?\s*(?:${UNCHANGED})\b`,
      'i',
    ),
    expectation: 'reuse-unchanged',
  },
  {
    pattern: new RegExp(
      String.raw`[\`'"]?([\w./-]+)[\`'"]?\s+without\s+(?:any\s+)?(?:modification|modifications|changes|change)\b`,
      'i',
    ),
    expectation: 'reuse-unchanged',
  },
  // "no changes to X", "X needs no changes"
  {
    pattern: new RegExp(String.raw`\bno\s+(?:changes?|modifications?)\s+(?:to|in)${SUBJECT}`, 'i'),
    expectation: 'reuse-unchanged',
  },
  // "verify that X already ...", "confirm X still ..."
  {
    pattern: new RegExp(String.raw`\b(?:verify|confirm)(?:\s+that)?${SUBJECT}`, 'i'),
    expectation: 'verify-only',
  },
];

/**
 * Guard clauses: the author FORBIDDING a behavioural change, rather than choosing not to make one.
 *
 * Subject-free on purpose. A guard's protected surface is frequently a phrase no concept matcher
 * resolves ("existing lookup behaviour"), and refusing to read the sentence as a guard because of
 * that would throw away the requirement instead of the ambiguity. Which surfaces the guard binds to
 * is decided later, by concept matching, exactly as it is for every other requirement.
 *
 * The wording is deliberately conservative: the costly mistake is reading a positive requirement as
 * a guard, because that hides work from review. "The digest must not send duplicate emails" is a
 * change requirement and must stay one — so the negated verbs are limited to the ones that talk
 * about the surface's own continuity (change / affect / modify / touch / break / regress).
 */
const GUARD_CLAUSES: readonly RegExp[] = [
  // "must not change", "should not be affected", "must never be modified", "must not break"
  /\b(?:must|shall|should|may|will|can)\s+(?:not|never)\s+(?:\w+\s+){0,2}?(?:change|be\s+(?:changed|affected|modified|touched|altered|impacted|broken)|break|regress)\b/i,
  // "must remain unchanged", "stays as-is", "remains unchanged", "continues to be the same"
  new RegExp(
    String.raw`\b(?:remain|remains|stay|stays|continue|continues)\s+(?:to\s+be\s+)?(?:${UNCHANGED})\b`,
    'i',
  ),
  // "must continue to send", "should keep working"
  /\b(?:must|shall|should|will)\s+(?:continue|keep)\s+(?:to\s+\w+|\w+ing)\b/i,
  // "no behaviour change", "no functional change", "no change in behaviour"
  /\bno\s+(?:behaviou?r(?:al)?|functional|semantic|observable)\s+(?:change|changes|difference|differences)\b/i,
  /\bno\s+(?:change|changes)\s+(?:in|to)\s+(?:the\s+)?(?:behaviou?r|semantics|output)\b/i,
  // "existing X continues to apply", "existing X is preserved"
  /\bexisting\s+[\w\s.`'-]{0,40}?(?:continues?\s+to\s+\w+|(?:is|are)\s+(?:preserved|unaffected|untouched)|remains?\s+(?:unchanged|as-is|intact)|stays?\s+(?:unchanged|as-is|intact))\b/i,
  // "nothing else should change", "no other job may be modified"
  /\b(?:nothing|no\s+other\s+\w+)\s+(?:else\s+)?(?:should|must|shall|will|may)\s+(?:change|be\s+(?:changed|affected|modified|touched))\b/i,
  // "preserve the existing dedup key", "preserving current semantics"
  /\b(?:preserve|preserving)\s+(?:the\s+)?(?:existing|current)\b/i,
  // "must stay backwards compatible"
  /\bbackwards?[-\s]?compatib(?:le|ility)\b/i,
];

export interface GuardCue {
  /** The wording that produced this reading, quoted so the classification is auditable. */
  readonly cue: string;
}

/** The regression-boundary clause this statement states, or undefined when it states none. */
export const guardCueOf = (statement: string): GuardCue | undefined => {
  for (const pattern of GUARD_CLAUSES) {
    const match = pattern.exec(statement);
    if (match !== null) {
      return { cue: match[0].trim() };
    }
  }
  return undefined;
};

/**
 * Wording that draws a boundary around "everything I did not mention" — the shape of statement the
 * forcing function exists for. It is only vague when the sentence ALSO names nothing: "nothing in
 * the `sendJob` may change" is a perfectly concrete guard that happens to open with "nothing".
 */
const VAGUE_SCOPE =
  /\b(?:nothing|anything|everything)\b|\b(?:all|any|no)\s+(?:other|remaining)\b|\bthe\s+rest\b|\b(?:any|every|some)where\s+else\b/i;

export type GuardReading =
  /** A boundary with a surface to anchor on — becomes a preservation requirement. */
  | { readonly kind: 'guard'; readonly cue: string }
  /** A boundary around nothing nameable — becomes a question, never an invented guard. */
  | { readonly kind: 'vague-guard'; readonly cue: string };

export const readGuard = (statement: string): GuardReading | undefined => {
  const guard = guardCueOf(statement);
  if (guard === undefined) {
    return undefined;
  }
  const vague = VAGUE_SCOPE.test(statement) && conceptsOf(statement).length === 0;
  return { kind: vague ? 'vague-guard' : 'guard', cue: guard.cue };
};

/** True when a statement under a preservation heading protects nothing a review could check. */
export const protectsNothingNameable = (statement: string): boolean =>
  VAGUE_SCOPE.test(statement) && conceptsOf(statement).length === 0;

const EXCERPT_LIMIT = 160;

const excerpt = (statement: string): string =>
  statement.length <= EXCERPT_LIMIT ? statement : `${statement.slice(0, EXCERPT_LIMIT - 1)}…`;

/**
 * The forcing function. "Nothing else should change" is not a regression boundary — it is the
 * absence of one, phrased as though it were. Inventing a guard from it would fabricate protection
 * over surfaces nobody chose; dropping it would lose the author's actual intent. So it is asked
 * back, naming the remedy: an explicit section listing the surfaces that must hold.
 */
export const boundaryQuestionFor = (
  statement: string,
  heading: string,
): ExtractedQuestionDraft => ({
  question:
    `Which specific surfaces must remain unchanged? "${excerpt(statement)}"` +
    `${heading.length === 0 ? '' : ` (under '${heading}')`} draws a regression boundary without ` +
    `naming what it protects. List the protected surfaces — the jobs, lookups, queries or ` +
    `contracts that must behave identically — under an "Explicitly unchanged" heading, so the ` +
    `implementation review can verify each one against the diff.`,
  reason:
    'The statement forbids a behavioural change but names no surface, so no guard could be ' +
    'anchored to a component. An unanchored boundary cannot be verified, and guessing which ' +
    'components it covers would fabricate protection the specification never granted.',
  severity: 'important',
  affectedRequirementStatements: [],
});
