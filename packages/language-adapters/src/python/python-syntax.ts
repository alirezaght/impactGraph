import { fieldNode, firstNamedChildOfType, namedChildrenOf } from '../tree-sitter/syntax.js';

import type { Node } from 'web-tree-sitter';

// Syntax-shape helpers for the Python CST. Purely structural: nothing here decides what a fact
// MEANS, only what the source literally says (PRD §30 — adapters report, they never guess).

const QUOTE_PATTERN = /^[A-Za-z]*("""|'''|"|')|("""|'''|"|')$/g;

/**
 * The text inside a string literal, prefixes and quotes removed — or undefined when the module
 * does not state a complete value.
 *
 * An f-string with a hole (`f"/deals/{deal_id}"`) is deliberately NOT a literal. Its parse
 * contains a `string_content` reading `/deals/`, and returning that would report a PREFIX as if it
 * were the whole value: a route fact for `/deals/`, a topic named `deal-` (PRD §35 — the value is
 * not stated, so there is nothing here the adapter may know). An f-string with no interpolation
 * (`f"/deals"`) states its value completely and is read normally.
 */
export const stringLiteralText = (node: Node): string | undefined => {
  if (node.type !== 'string' || firstNamedChildOfType(node, 'interpolation') !== undefined) {
    return undefined;
  }
  const content = firstNamedChildOfType(node, 'string_content');
  return content?.text ?? node.text.replace(QUOTE_PATTERN, '');
};

/** Dotted source text of a callee/decorator: `router.get` → 'router.get', `f` → 'f'. */
export const dottedName = (node: Node): string | undefined => {
  if (node.type === 'identifier' || node.type === 'dotted_name') {
    return node.text;
  }
  if (node.type !== 'attribute') {
    return undefined; // subscripts, calls-of-calls: out of scope, never guessed
  }
  const object = fieldNode(node, 'object');
  const attribute = fieldNode(node, 'attribute');
  if (object === undefined || attribute === undefined) {
    return undefined;
  }
  const objectName = dottedName(object);
  return objectName === undefined ? undefined : `${objectName}.${attribute.text}`;
};

export interface CallArguments {
  readonly strings: readonly string[];
  readonly identifiers: readonly string[];
  /** String-valued keyword arguments, e.g. `include_router(r, prefix="/deals")`. */
  readonly keywordStrings: Readonly<Record<string, string>>;
  /** Identifier-valued keyword arguments, e.g. `@app.get("/x", response_model=Deal)`. */
  readonly keywordIdentifiers: Readonly<Record<string, string>>;
}

interface MutableCallArguments {
  readonly strings: string[];
  readonly identifiers: string[];
  readonly keywordStrings: Record<string, string>;
  readonly keywordIdentifiers: Record<string, string>;
}

const addKeyword = (argument: Node, into: MutableCallArguments): void => {
  const name = fieldNode(argument, 'name');
  const value = fieldNode(argument, 'value');
  if (name === undefined || value === undefined) {
    return;
  }
  const text = stringLiteralText(value);
  if (text !== undefined) {
    into.keywordStrings[name.text] = text;
  } else if (value.type === 'identifier') {
    into.keywordIdentifiers[name.text] = value.text;
  }
};

/** Split an `argument_list` into the literal shapes adapters can act on. Everything else drops. */
export const callArguments = (argumentList: Node | undefined): CallArguments => {
  const result: MutableCallArguments = {
    strings: [],
    identifiers: [],
    keywordStrings: {},
    keywordIdentifiers: {},
  };
  for (const argument of argumentList === undefined ? [] : namedChildrenOf(argumentList)) {
    const text = stringLiteralText(argument);
    if (text !== undefined) {
      result.strings.push(text);
    } else if (argument.type === 'identifier') {
      result.identifiers.push(argument.text);
    } else if (argument.type === 'keyword_argument') {
      addKeyword(argument, result);
    }
  }
  return result;
};
