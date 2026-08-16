import type { ConfigDeclaration } from './check-config-semantics.js';

/**
 * Read how a source file declares one configuration value, in the handful of shapes where a
 * high-confidence static conclusion exists (PRD-level rule R10; design §8: literal defaults in a
 * small set of shapes ship, everything else is silence, never a guess).
 *
 * Pure text analysis: the caller owns file access and decides WHICH files are worth reading —
 * typically the files the graph or the fragment cache already tie to the name.
 */

export interface ExtractConfigDeclarationsInput {
  readonly name: string;
  readonly filePath: string;
  readonly content: string;
  readonly evidenceIds: readonly string[];
}

const LITERAL = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?|\{\s*\}|\[\s*\])/;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lineOf = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length;

/** `NAME = <literal>` — a module constant or class attribute stating the default in place. */
const assignmentLiteral = (content: string, name: string): string | undefined => {
  const pattern = new RegExp(`^\\s*${escape(name)}\\s*=\\s*${LITERAL.source}\\s*$`, 'm');
  return pattern.exec(content)?.[1];
};

interface ReadShape {
  readonly index: number;
  readonly defaultLiteral?: string;
  readonly toleratesAbsence?: boolean;
}

/** `os.environ.get("NAME")`, with an optional default that may point at a same-file attribute. */
const environGet = (content: string, name: string): ReadShape | undefined => {
  const pattern = new RegExp(
    `environ\\.get\\(\\s*["']${escape(name)}["']\\s*(?:,\\s*([^)]+))?\\)`,
  );
  const match = pattern.exec(content);
  if (match === null) {
    return undefined;
  }
  const rawDefault = match[1]?.trim();
  if (rawDefault === undefined) {
    return { index: match.index, toleratesAbsence: true };
  }
  if (LITERAL.test(rawDefault) && new RegExp(`^${LITERAL.source}$`).test(rawDefault)) {
    return { index: match.index, defaultLiteral: rawDefault, toleratesAbsence: true };
  }
  // A default that names an attribute ("self.X", "X") is followed exactly one hop, same file.
  const attribute = /^(?:self\.|cls\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(rawDefault)?.[1];
  const resolved = attribute === undefined ? undefined : assignmentLiteral(content, attribute);
  return resolved === undefined
    ? { index: match.index, toleratesAbsence: true }
    : { index: match.index, defaultLiteral: resolved, toleratesAbsence: true };
};

/** `os.environ["NAME"]` — the process cannot start without it. */
const environBracket = (content: string, name: string): ReadShape | undefined => {
  const match = new RegExp(`environ\\[\\s*["']${escape(name)}["']\\s*\\]`).exec(content);
  return match === null ? undefined : { index: match.index };
};

/** `process.env.NAME ?? <literal>` and the `||` spelling. */
const processEnv = (content: string, name: string): ReadShape | undefined => {
  const pattern = new RegExp(
    `process\\.env(?:\\.${escape(name)}|\\[["']${escape(name)}["']\\])\\s*(?:(\\?\\?|\\|\\|)\\s*${LITERAL.source})?`,
  );
  const match = pattern.exec(content);
  if (match === null) {
    return undefined;
  }
  const literal = match[2];
  return literal === undefined
    ? { index: match.index }
    : { index: match.index, defaultLiteral: literal, toleratesAbsence: true };
};

/**
 * At most one declaration per (file, name): the read shape wins over a bare assignment because it
 * states how absence behaves, which is the fact the semantics check needs.
 */
export const extractConfigDeclarations = (
  input: ExtractConfigDeclarationsInput,
): readonly ConfigDeclaration[] => {
  const read =
    environGet(input.content, input.name) ??
    processEnv(input.content, input.name) ??
    environBracket(input.content, input.name);
  if (read !== undefined) {
    // A bare bracket read carries no default and no tolerance — required by construction.
    return [
      {
        name: input.name,
        filePath: input.filePath,
        line: lineOf(input.content, read.index),
        ...(read.defaultLiteral === undefined ? {} : { defaultLiteral: read.defaultLiteral }),
        ...(read.toleratesAbsence === undefined ? {} : { toleratesAbsence: read.toleratesAbsence }),
        evidenceIds: input.evidenceIds,
      },
    ];
  }
  return [];
};
