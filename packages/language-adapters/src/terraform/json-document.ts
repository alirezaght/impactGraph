import { fieldNode, namedChildrenOf, rangeOfNode } from '../tree-sitter/syntax.js';

import type { SourceRange } from '@impactgraph/domain';
import type { Node } from 'web-tree-sitter';

// A JSON document with source positions — the thing `JSON.parse` cannot give, and the only reason
// `.tf.json` was unsupported (epic-16).
//
// Evidence that cannot point at a line is materially worse than none: the evidence panel opens a
// file at a range and review compares facts at symbol level, so a `.tf.json` fact with nothing but
// a filename is not a fact anybody can check. This module supplies the missing half.
//
// WHY tree-sitter AND NOT A HAND-WRITTEN TOKENIZER. `tree-sitter-wasms` — already a dependency,
// already loaded for Python, Java and HTML — ships a prebuilt `tree-sitter-json.wasm`. Using it
// costs no new package, keeps ADR-0008's "non-TS languages via tree-sitter WASM" literally intact
// (no amendment needed), and inherits the error recovery and the warning shape every other adapter
// already has. It is also strictly more accurate for the case that matters here: the CST exposes
// the `string_content` node, so a reference inside an interpolation gets an exact column even when
// the literal carries escape sequences. ADR-0014 already settled this trade for HCL in the same
// direction — a real grammar over a scanner we would own and have to maintain.

/** A string literal, plus where its DECODED content begins in the file. */
export interface JsonString {
  readonly kind: 'string';
  readonly value: string;
  readonly range: SourceRange;
  /** Range of the text between the quotes; the anchor for `rangeWithinString`. */
  readonly contentRange: SourceRange;
  /** With an escape present the decoded value is shorter than its source, so offsets stop mapping. */
  readonly hasEscapes: boolean;
}

export type JsonValue =
  | JsonString
  | { readonly kind: 'object'; readonly entries: readonly JsonEntry[]; readonly range: SourceRange }
  | { readonly kind: 'array'; readonly items: readonly JsonValue[]; readonly range: SourceRange }
  | { readonly kind: 'number'; readonly value: number; readonly range: SourceRange }
  | { readonly kind: 'other'; readonly range: SourceRange };

export interface JsonEntry {
  readonly key: string;
  readonly keyRange: SourceRange;
  readonly value: JsonValue;
  /** The `"x": …` pair as a whole. */
  readonly range: SourceRange;
}

/** Bound on one document: a hostile file costs a truncated read, never the run (PRD §42.5). */
const MAX_DEPTH = 64;

const ESCAPES = new Map<string, string>([
  ['\\"', '"'],
  ['\\\\', '\\'],
  ['\\/', '/'],
  ['\\b', '\b'],
  ['\\f', '\f'],
  ['\\n', '\n'],
  ['\\r', '\r'],
  ['\\t', '\t'],
]);

const HEX_ESCAPE = /^\\u[0-9a-fA-F]{4}$/;

/** One `escape_sequence` node's text → the character it denotes; unknown escapes stay verbatim. */
const decodeEscape = (text: string): string => {
  const simple = ESCAPES.get(text);
  if (simple !== undefined) {
    return simple;
  }
  return HEX_ESCAPE.test(text) ? String.fromCharCode(Number.parseInt(text.slice(2), 16)) : text;
};

const EMPTY_CONTENT = (node: Node): SourceRange => {
  const range = rangeOfNode(node);
  return { ...range, startColumn: range.startColumn + 1, endColumn: range.endColumn - 1 };
};

const readString = (node: Node): JsonString => {
  const parts = namedChildrenOf(node);
  const content = parts.filter((part) => part.type === 'string_content');
  const escapes = parts.filter((part) => part.type === 'escape_sequence');
  const value = parts
    .filter((part) => part.type === 'string_content' || part.type === 'escape_sequence')
    .map((part) => (part.type === 'escape_sequence' ? decodeEscape(part.text) : part.text))
    .join('');
  const first = content[0] ?? escapes[0];
  return {
    kind: 'string',
    value,
    range: rangeOfNode(node),
    contentRange: first === undefined ? EMPTY_CONTENT(node) : rangeOfNode(first),
    hasEscapes: escapes.length > 0,
  };
};

const readEntry = (pair: Node, depth: number): JsonEntry | undefined => {
  const keyNode = fieldNode(pair, 'key');
  const valueNode = fieldNode(pair, 'value');
  if (keyNode?.type !== 'string' || valueNode === undefined) {
    return undefined;
  }
  const key = readString(keyNode);
  return {
    key: key.value,
    keyRange: key.range,
    value: readValue(valueNode, depth + 1),
    range: rangeOfNode(pair),
  };
};

const readObject = (node: Node, depth: number): JsonValue => {
  const entries: JsonEntry[] = [];
  for (const child of namedChildrenOf(node)) {
    const entry = child.type === 'pair' ? readEntry(child, depth) : undefined;
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return { kind: 'object', entries, range: rangeOfNode(node) };
};

const readNumber = (node: Node): JsonValue => {
  const parsed = Number(node.text);
  return Number.isFinite(parsed)
    ? { kind: 'number', value: parsed, range: rangeOfNode(node) }
    : { kind: 'other', range: rangeOfNode(node) };
};

function readValue(node: Node, depth: number): JsonValue {
  if (depth > MAX_DEPTH) {
    return { kind: 'other', range: rangeOfNode(node) };
  }
  if (node.type === 'object') {
    return readObject(node, depth);
  }
  if (node.type === 'array') {
    return {
      kind: 'array',
      items: namedChildrenOf(node).map((item) => readValue(item, depth + 1)),
      range: rangeOfNode(node),
    };
  }
  if (node.type === 'string') {
    return readString(node);
  }
  return node.type === 'number' ? readNumber(node) : { kind: 'other', range: rangeOfNode(node) };
}

/**
 * The single value one parsed JSON document contains, or undefined when there is not exactly one.
 *
 * A document tree-sitter recovered from is refused rather than read. That is stricter than the HCL
 * path deliberately: in JSON the nesting IS the block structure, so a missing brace does not
 * corrupt one block — it silently re-parents every block after it, and reporting relabelled
 * resources would be worse than reporting none (PRD §34).
 */
export const readJsonDocument = (root: Node): JsonValue | undefined => {
  if (root.hasError) {
    return undefined;
  }
  const values = namedChildrenOf(root).filter((child) => child.type !== 'comment');
  const only = values.length === 1 ? values[0] : undefined;
  return only === undefined ? undefined : readValue(only, 0);
};

/**
 * The range of a substring INSIDE a JSON string value, in file coordinates.
 *
 * Anchored at the literal's `string_content`, so no quote arithmetic is involved. Exact whenever
 * the literal carries no escape sequence; with one present the decoded value is shorter than the
 * source it came from, offsets stop mapping, and the caller gets the whole literal's range — still
 * a real line and column, just a wider one, and never a fabricated position.
 */
export const rangeWithinString = (
  literal: JsonString,
  offset: number,
  length: number,
): SourceRange => {
  if (literal.hasEscapes) {
    return literal.range;
  }
  const startColumn = literal.contentRange.startColumn + offset;
  return {
    startLine: literal.contentRange.startLine,
    startColumn,
    endLine: literal.contentRange.startLine,
    endColumn: startColumn + length,
  };
};
