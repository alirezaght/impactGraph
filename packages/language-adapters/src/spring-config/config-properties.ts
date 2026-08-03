import { cappedLines, ConfigEntries } from './config-entries.js';

import type { ConfigRead } from './config-entries.js';

// `application.properties` — `java.util.Properties`' line format, restricted to the shapes whose
// meaning is unambiguous without implementing the whole escape grammar.
//
// Read: `key=value`, `key: value`, `#`/`!` comments, surrounding whitespace.
// Refused: a logical line continued with a trailing `\` (its value is not on this line), and any
// key or value containing a backslash escape (`a\:b`, `A`). Decoding those halfway would
// produce a value the file does not state, which is the one failure mode this whole area exists to
// avoid (PRD §35).

const COMMENT_START = new Set(['#', '!']);

/** True when the line ends with an ODD number of backslashes, i.e. it continues on the next one. */
const continues = (line: string): boolean => {
  let count = 0;
  for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
};

/** The first unescaped `=` or `:`, or -1. */
const separatorIndex = (line: string): number => {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\') {
      return -1; // an escape before the separator — refused wholesale, see the module comment
    }
    if (character === '=' || character === ':') {
      return index;
    }
  }
  return -1;
};

interface Reader {
  readonly entries: ConfigEntries;
  /** True while inside the tail of a `\\`-continued logical line, whose value is not on one line. */
  continuing: boolean;
}

const readLine = (reader: Reader, raw: string, lineNumber: number): void => {
  const line = raw.trim();
  const wasContinuation = reader.continuing;
  reader.continuing = line !== '' && continues(line);
  if (wasContinuation || line === '' || COMMENT_START.has(line.slice(0, 1))) {
    return;
  }
  const separator = separatorIndex(line);
  const value = separator < 0 ? '' : line.slice(separator + 1).trim();
  if (separator < 0 || value.includes('\\')) {
    reader.entries.skip();
    return;
  }
  reader.entries.add(line.slice(0, separator).trim(), value, lineNumber);
};

export const readPropertiesConfig = (content: string): ConfigRead => {
  const { lines, truncated } = cappedLines(content);
  const reader: Reader = { entries: new ConfigEntries(), continuing: false };
  for (const [index, raw] of lines.entries()) {
    readLine(reader, raw, index + 1);
  }
  for (let index = 0; index < truncated; index += 1) {
    reader.entries.skip();
  }
  return reader.entries.read();
};
