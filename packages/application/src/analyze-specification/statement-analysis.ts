// Per-statement heuristics shared by the structured extractor and the prose fallback. Extracted
// from fallback-extractor.ts so both paths classify a statement the same way — a requirement's
// type must not depend on which extraction strategy produced it. Pure: no I/O, no randomness.

const TYPE_KEYWORDS: readonly [RegExp, string][] = [
  [/\bmigrat/i, 'data'],
  [/\b(secur|auth|permission|access control)/i, 'security'],
  [/\b(performance|latency|throughput|under \d+\s*(ms|s\b))/i, 'performance'],
  [/\b(log|logging|metric|monitor|alert|trace)/i, 'observability'],
  [/\btest(s|ing|ed)?\b/i, 'testing'],
  [/\b(document|docs|readme)\b/i, 'documentation'],
  [/\b(event|publish|subscribe|queue|topic|webhook|api)\b/i, 'integration'],
  [/\b(deploy|rollout|backup|restore|on-call)\b/i, 'operational'],
];

export const classifyType = (statement: string): string => {
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(statement)) {
      return type;
    }
  }
  return 'functional';
};

export const priorityOf = (statement: string): string | undefined => {
  if (/\bmust\b/i.test(statement)) {
    return 'must';
  }
  if (/\bshould\b/i.test(statement)) {
    return 'should';
  }
  if (/\bcould\b/i.test(statement)) {
    return 'could';
  }
  return undefined;
};

// Prose abbreviations the dotted pattern would otherwise capture ("e.g." reads as e[.g]).
const ABBREVIATION_NOISE = new Set(['e.g', 'i.e', 'a.k.a', 'p.s']);
const VERSION_LIKE = /^v?\d+(?:\.\d+)+$/;
const MAX_CONCEPT_LENGTH = 80;
const MAX_CONCEPT_WORDS = 4;

/**
 * A concept must plausibly map to an architectural element. A backticked span of five or more
 * words is a quoted sentence, not a component name; an abbreviation or version number maps to
 * nothing. The length bound still admits deep monorepo file paths (which carry no spaces).
 */
const isNoiseTerm = (term: string): boolean =>
  ABBREVIATION_NOISE.has(term.toLowerCase()) ||
  VERSION_LIKE.test(term) ||
  term.length > MAX_CONCEPT_LENGTH ||
  term.split(/\s+/).length > MAX_CONCEPT_WORDS;

/**
 * The single concept-hygiene gate, shared by every extraction strategy. Model-authored concepts
 * go through the SAME filter as deterministically mined ones (a requirement's candidate set must
 * not depend on which strategy produced it); a dropped term is simply not a candidate — never an
 * error.
 */
export const isViableConcept = (term: string): boolean => term.length > 1 && !isNoiseTerm(term);

/**
 * Concept candidates: backticked terms, multi-humped CamelCase, dotted event names, and
 * snake_case identifiers.
 *
 * The last two were added because event-driven specifications name their subjects that way —
 * `notification.nda_signature_request` is the single most important term in a spec about it, and a
 * CamelCase-only rule sees nothing at all. Every candidate is still only a candidate: it becomes
 * an impact ONLY if concept matching resolves it to an indexed node (item 2).
 */
/** SCREAMING_SNAKE names are how specifications assert constants and environment variables. */
const SCREAMING_SNAKE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

const KEBAB_CASE = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g;

/**
 * Deployable and integration nouns a specification uses to name a component in prose — "the
 * user-profile service", "the billing api". The head must be lowercase (a capitalized head is a
 * proper noun mid-phrase, e.g. "Cloud Run service") and must not be a determiner or a generic
 * qualifier, so "the service" never becomes a candidate.
 */
const ARCHITECTURAL_PHRASE =
  /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*) (service|api|gateway|frontend|backend|worker|client|app|server|job|queue|topic|database)\b/g;

const PHRASE_STOPWORD_HEADS = new Set([
  ...['the', 'a', 'an', 'this', 'that', 'these', 'those', 'each', 'every', 'any', 'some', 'no'],
  ...['one', 'another', 'its', 'their', 'our', 'your', 'new', 'existing', 'same', 'given'],
  ...['such', 'other', 'which', 'per', 'current', 'proposed', 'requested', 'nominal', 'named'],
  ...['target', 'legacy', 'production', 'downstream', 'upstream', 'external', 'internal'],
  ...['remote', 'local', 'peer', 'web', 'nominated', 'affected', 'calling', 'consuming'],
]);

const matchesOf = (statement: string, pattern: RegExp): string[] =>
  [...statement.matchAll(pattern)].map((match) => match[1] ?? '');

const architecturalPhrases = (statement: string): string[] =>
  [...statement.matchAll(ARCHITECTURAL_PHRASE)]
    .filter((match) => !PHRASE_STOPWORD_HEADS.has(match[1] ?? ''))
    .map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`);

export const conceptsOf = (statement: string): string[] => {
  const backticked = matchesOf(statement, /`([^`]+)`/g);
  const camelCase = matchesOf(statement, /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g);
  const dotted = matchesOf(statement, /\b([a-z][a-z0-9]*(?:[._][a-z0-9]+){1,4})\b/g);
  const screaming = matchesOf(statement, SCREAMING_SNAKE);
  const kebab = matchesOf(statement, KEBAB_CASE);
  const phrases = architecturalPhrases(statement);
  return [
    ...new Set(
      [...backticked, ...camelCase, ...dotted, ...screaming, ...kebab, ...phrases].filter(
        isViableConcept,
      ),
    ),
  ];
};

/**
 * A speculative concept was MINED from prose (kebab-case words, architectural noun phrases); an
 * asserted one was WRITTEN as an identifier (backticks, CamelCase, dotted, SCREAMING_SNAKE). The
 * difference decides what failing to resolve means: an unresolved asserted identifier is a warning
 * the user should read, an unresolved speculative candidate is silently dropped — hyphenated
 * English ("long-running") must not fill the report with noise.
 */
export const isSpeculativeConcept = (concept: string): boolean =>
  concept.includes(' ') || /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(concept);

const BULLET = /^([-*+]|\d+[.)])\s+/;

/**
 * Markdown hard-wraps prose, so a line break is not a statement boundary. Consecutive prose
 * lines are joined into one block; blank lines, headings, and bullet markers end the current
 * block. Splitting per line instead produced fragments like "which packaging excludes." that
 * carry no requirement and match nothing in the graph.
 */
const proseBlocks = (rawText: string): string[] => {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      blocks.push(current.join(' '));
      current = [];
    }
  };
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      flush(); // headings give structure, not requirements
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet === null) {
      current.push(line);
      continue;
    }
    flush(); // each list item is its own statement, not a continuation of the previous one
    current.push(line.slice(bullet[0].length));
  }
  flush();
  return blocks;
};

/**
 * A sentence ends at terminal punctuation followed by whitespace AND an opening token — an
 * uppercase letter, backtick, or quote. Requiring the opener keeps "node.js", "e.g." and
 * version numbers inside their sentence.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z`"'([])/;

/** Sentence-level statements of running prose. The fallback path only (see the extractor). */
export const proseStatements = (rawText: string): readonly string[] => {
  const statements: string[] = [];
  for (const block of proseBlocks(rawText)) {
    for (const sentence of block.split(SENTENCE_BOUNDARY)) {
      const statement = sentence.trim();
      if (statement.length >= 12) {
        statements.push(statement);
      }
    }
  }
  return statements;
};
