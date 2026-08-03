import { rangeWithinString } from './json-document.js';
import { addressFromSegments } from './terraform-values.js';

import type { JsonString } from './json-document.js';
import type { TerraformReference } from './terraform-values.js';

// References inside a `${…}` interpolation in a `.tf.json` string.
//
// In HCL a reference is bare (`google_pubsub_topic.deal_events.name`) and the grammar hands it
// over already parsed. Terraform's JSON syntax has no expression grammar of its own: an expression
// is written inside a string, wrapped in `${…}`, and it is HCL from there on. So this reads the
// interpolation body for the one shape that matters — a dotted chain of identifiers — and hands
// the segments to the SAME `addressFromSegments` the HCL path uses, so the two syntaxes cannot
// disagree about what an address is.
//
// This is a lexer, not an evaluator (PRD §35). `${format("%s", var.p)}` yields `var.p`; the value
// of the format call is not computed, guessed, or claimed. Quoted spans inside the expression are
// skipped so a dotted string like `"gcr.io/x"` cannot masquerade as a resource address.

/** One pathological value cannot spin here; a real expression has a handful of references. */
const MAX_REFERENCES_PER_STRING = 32;

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_-]/;

interface Chain {
  readonly segments: readonly string[];
  readonly offset: number;
  readonly length: number;
}

/** Read `a.b.c` starting at `start`, or nothing when the text there is not an identifier chain. */
const readChain = (text: string, start: number): Chain | undefined => {
  if (!IDENTIFIER_START.test(text[start] ?? '')) {
    return undefined;
  }
  const segments: string[] = [];
  let index = start;
  for (;;) {
    let segment = '';
    while (index < text.length && IDENTIFIER_PART.test(text[index] ?? '')) {
      segment += text[index];
      index += 1;
    }
    segments.push(segment);
    if (text[index] !== '.' || !IDENTIFIER_START.test(text[index + 1] ?? '')) {
      break;
    }
    index += 1;
  }
  return { segments, offset: start, length: index - start };
};

/** Skip a `"…"` span inside the expression, honouring backslash escapes. Returns the index after. */
const skipQuoted = (text: string, start: number): number => {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  return index;
};

/** From just past a `${`, the offset one past the matching `}` and whether one was found. */
const scanToClose = (
  value: string,
  body: number,
): { readonly end: number; readonly closed: boolean } => {
  let depth = 1;
  let scan = body;
  while (scan < value.length && depth > 0) {
    const character = value[scan];
    depth += character === '{' ? 1 : 0;
    depth -= character === '}' ? 1 : 0;
    scan = character === '"' ? skipQuoted(value, scan) : scan + 1;
  }
  return { end: scan, closed: depth === 0 };
};

/** The `${…}` spans of a value: `[bodyStart, bodyEnd)` offsets into the decoded string. */
const interpolationSpans = (value: string): readonly (readonly [number, number])[] => {
  const spans: (readonly [number, number])[] = [];
  let index = 0;
  while (index < value.length - 1 && spans.length < MAX_REFERENCES_PER_STRING) {
    if (value[index] !== '$' || value[index + 1] !== '{') {
      index += 1;
      continue;
    }
    const body = index + 2;
    const closing = scanToClose(value, body);
    spans.push([body, closing.closed ? closing.end - 1 : value.length]);
    index = closing.end;
  }
  return spans;
};

const chainsIn = (value: string, span: readonly [number, number]): readonly Chain[] => {
  const chains: Chain[] = [];
  let index = span[0];
  while (index < span[1] && chains.length < MAX_REFERENCES_PER_STRING) {
    if (value[index] === '"') {
      index = skipQuoted(value, index);
      continue;
    }
    const chain = readChain(value, index);
    if (chain === undefined) {
      index += 1;
      continue;
    }
    chains.push(chain);
    index = chain.offset + chain.length;
  }
  return chains;
};

/** True when the value contains an interpolation, i.e. Terraform will evaluate it at apply time. */
export const isInterpolated = (value: string): boolean => interpolationSpans(value).length > 0;

/**
 * Every Terraform address a JSON string literal refers to, each with the range of the exact text
 * that names it — the same evidence quality the HCL path produces, except for a literal carrying
 * escape sequences, where the range widens to the whole literal (see `rangeWithinString`).
 */
export const referencesInString = (literal: JsonString): readonly TerraformReference[] => {
  const found: TerraformReference[] = [];
  for (const span of interpolationSpans(literal.value)) {
    for (const chain of chainsIn(literal.value, span)) {
      const address = addressFromSegments(chain.segments);
      if (address !== undefined) {
        found.push({ ...address, range: rangeWithinString(literal, chain.offset, chain.length) });
      }
    }
  }
  return found;
};
