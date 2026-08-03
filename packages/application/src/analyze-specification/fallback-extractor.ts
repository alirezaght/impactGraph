import type { SpecificationExtraction } from './extraction-types.js';

// Deterministic fallback (PRD §8): with no provider, the spec still becomes draft
// requirements via plain-text heuristics, so the whole pipeline keeps working with
// reduced interpretation. Pure — no I/O, no randomness.

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

const classify = (statement: string): string => {
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(statement)) {
      return type;
    }
  }
  return 'functional';
};

const priorityOf = (statement: string): string | undefined => {
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

/** Backticked terms plus multi-humped CamelCase identifiers make decent concept candidates. */
const conceptsOf = (statement: string): string[] => {
  const backticked = [...statement.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
  const camelCase = [...statement.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)].map(
    (match) => match[1] ?? '',
  );
  return [...new Set([...backticked, ...camelCase].filter((term) => term.length > 1))];
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

const candidateStatements = (rawText: string): string[] => {
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

export const fallbackExtraction = (rawText: string): SpecificationExtraction => {
  const seen = new Set<string>();
  const requirements = [];
  for (const statement of candidateStatements(rawText)) {
    const key = statement.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const priority = priorityOf(statement);
    requirements.push({
      statement,
      type: classify(statement),
      concepts: conceptsOf(statement),
      actors: [],
      ...(priority === undefined ? {} : { priority }),
      sourceExcerpt: statement,
    });
  }
  return { requirements, actors: [], constraints: [], openQuestions: [] };
};
