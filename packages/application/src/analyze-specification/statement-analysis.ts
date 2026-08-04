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

/**
 * Concept candidates: backticked terms, multi-humped CamelCase, dotted event names, and
 * snake_case identifiers.
 *
 * The last two were added because event-driven specifications name their subjects that way —
 * `notification.nda_signature_request` is the single most important term in a spec about it, and a
 * CamelCase-only rule sees nothing at all. Every candidate is still only a candidate: it becomes
 * an impact ONLY if concept matching resolves it to an indexed node (item 2).
 */
export const conceptsOf = (statement: string): string[] => {
  const backticked = [...statement.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
  const camelCase = [...statement.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)].map(
    (match) => match[1] ?? '',
  );
  const dotted = [...statement.matchAll(/\b([a-z][a-z0-9]*(?:[._][a-z0-9]+){1,4})\b/g)].map(
    (match) => match[1] ?? '',
  );
  return [...new Set([...backticked, ...camelCase, ...dotted].filter((term) => term.length > 1))];
};

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
