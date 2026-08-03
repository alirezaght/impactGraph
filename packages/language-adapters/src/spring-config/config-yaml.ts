import { cappedLines, ConfigEntries } from './config-entries.js';

import type { ConfigRead } from './config-entries.js';

// The nested-scalar-mapping subset of YAML, flattened to Spring's dotted keys:
// `deals: { topic: deal-events }` → `deals.topic = deal-events`.
//
// Everything outside that subset is REFUSED, not approximated — a sequence, a block scalar
// (`|`/`>`), a flow collection (`{`/`[`), an anchor/alias/merge (`&`/`*`/`<<`), a tag (`!`), a tab
// in the indentation, a line whose `key:` shape the reader cannot see. Each refusal costs one
// entry, which costs one placeholder, which resolves to nothing. That is the correct outcome: a
// half-decoded value that then names a topic is exactly the invented fact §35 forbids.
//
// Multi-document files (`---`) ARE read, all documents, because that is how Spring writes
// profile-specific overrides in one file. The reader does not decide which document wins — it
// records both statements, and the resolver refuses a key its documents disagree about.

const MAX_DEPTH = 16;

/** `key:` or `key: value`, with the key holding no whitespace and no colon. */
const MAPPING = /^([^\s:#][^:]*?)\s*:(?:\s+(.*))?$/;

const REFUSED_VALUE_START = new Set(['|', '>', '{', '[', '&', '*', '!', '?']);

/** A quoted scalar, optionally followed by a trailing comment. A backslash inside is refused. */
const DOUBLE_QUOTED = /^"([^"\\]*)"(?:\s+#.*)?$/;
const SINGLE_QUOTED = /^'([^']*)'(?:\s+#.*)?$/;

/**
 * The scalar a value position states, or undefined when it states something this reader refuses.
 *
 * An unquoted scalar ends at ` #` (YAML's inline comment rule); a quoted one is taken verbatim,
 * and one containing a backslash escape is refused rather than half-unescaped.
 */
const quotedScalar = (text: string): string | undefined => {
  const double = DOUBLE_QUOTED.exec(text);
  return double === null ? SINGLE_QUOTED.exec(text)?.[1] : double[1];
};

const scalarValue = (raw: string): string | undefined => {
  const text = raw.trim();
  const quoted = quotedScalar(text);
  if (quoted !== undefined) {
    return quoted;
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return undefined; // unterminated, or carrying escapes — not decoded, not guessed
  }
  const commentAt = text.indexOf(' #');
  const scalar = (commentAt < 0 ? text : text.slice(0, commentAt)).trim();
  return scalar === '' || REFUSED_VALUE_START.has(scalar.slice(0, 1)) ? undefined : scalar;
};

interface Level {
  readonly indent: number;
  readonly key: string;
}

/** Indentation width, or undefined when the line indents with a tab (invalid YAML). */
const indentOf = (line: string): number | undefined => {
  const width = line.length - line.trimStart().length;
  return line.slice(0, width).includes('\t') ? undefined : width;
};

const DOCUMENT_SEPARATOR = /^---(\s|$)/;

interface Reader {
  readonly entries: ConfigEntries;
  readonly stack: Level[];
}

/** One line of a document, given the mapping levels open above it. */
const readLine = (reader: Reader, line: string, lineNumber: number): void => {
  const indent = indentOf(line);
  const content = indent === undefined ? '' : line.slice(indent).trimEnd();
  if (indent === undefined) {
    reader.entries.skip();
    return;
  }
  if (content === '' || content.startsWith('#')) {
    return;
  }
  if (DOCUMENT_SEPARATOR.test(content)) {
    reader.stack.length = 0;
    return;
  }
  const matched = content.startsWith('-') ? null : MAPPING.exec(content);
  if (matched === null) {
    reader.entries.skip();
    return;
  }
  applyMapping(reader, { indent, key: (matched[1] ?? '').trim() }, matched[2], lineNumber);
};

const applyMapping = (
  reader: Reader,
  level: Level,
  value: string | undefined,
  lineNumber: number,
): void => {
  while (
    reader.stack.length > 0 &&
    (reader.stack[reader.stack.length - 1]?.indent ?? 0) >= level.indent
  ) {
    reader.stack.pop();
  }
  if (reader.stack.length >= MAX_DEPTH) {
    reader.entries.skip();
    return;
  }
  const path = [...reader.stack.map((entry) => entry.key), level.key].join('.');
  if (value === undefined || value.trim() === '') {
    reader.stack.push(level);
    return;
  }
  const scalar = scalarValue(value);
  if (scalar === undefined) {
    reader.entries.skip();
    return;
  }
  reader.entries.add(path, scalar, lineNumber);
};

/** Read one `application*.yml`. Parsing text is not executing it — nothing here evaluates. */
export const readYamlConfig = (content: string): ConfigRead => {
  const { lines, truncated } = cappedLines(content);
  const reader: Reader = { entries: new ConfigEntries(), stack: [] };
  for (const [index, line] of lines.entries()) {
    readLine(reader, line, index + 1);
  }
  for (let index = 0; index < truncated; index += 1) {
    reader.entries.skip();
  }
  return reader.entries.read();
};
