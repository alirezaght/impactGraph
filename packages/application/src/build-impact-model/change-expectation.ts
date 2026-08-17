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

export type ChangeExpectationCue = {
  readonly expectation: 'reuse-unchanged' | 'verify-only';
  /** The wording that produced this reading, quoted so the classification is auditable. */
  readonly cue: string;
};

interface Pattern {
  readonly pattern: RegExp;
  readonly expectation: 'reuse-unchanged' | 'verify-only';
}

/**
 * Each pattern captures the clause AND the subject it governs, so the subject can be matched
 * against the impact's concept. `SUBJECT` is deliberately narrow: an identifier-ish run of words,
 * optionally backticked or quoted, immediately adjacent to the clause.
 */
const SUBJECT = String.raw`\s+(?:the\s+)?(?:existing\s+|current\s+)?[\`'"]?([\w./-]+)[\`'"]?`;

const PATTERNS: readonly Pattern[] = [
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
      String.raw`[\`'"]?([\w./-]+)[\`'"]?\s+(?:is|are|remains?|stays?)?\s*(?:unchanged|untouched|as-is|as is)\b`,
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
 */
export const changeExpectationFor = (
  statement: string,
  conceptNames: readonly string[],
): ChangeExpectationCue | undefined => {
  if (conceptNames.length === 0) {
    return undefined;
  }
  for (const { pattern, expectation } of PATTERNS) {
    const match = pattern.exec(statement);
    const subject = match?.[1];
    if (match !== null && subject !== undefined && governs(subject, conceptNames)) {
      return { expectation, cue: match[0].trim() };
    }
  }
  return undefined;
};
