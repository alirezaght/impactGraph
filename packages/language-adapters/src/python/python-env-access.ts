import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { dottedName, stringLiteralText } from './python-syntax.js';

import type { Node } from 'web-tree-sitter';

// `os.environ["X"]`, `os.getenv("X")`, `os.environ.get("X")` — the Python expressions that state an
// ENVIRONMENT VARIABLE NAME outright. The mirror of `typescript/env-access.ts`, and just as narrow.
//
// Gated on a module-level `import os`, because `os` is a name a module must bind and a file is free
// to bind it to something else. `process` in TypeScript is a genuine global, so that reader needs
// no equivalent check.
//
// Deliberately refused:
// * `from os import getenv` / `import os as o` — the reader would have to track the binding, and a
//   rebound or shadowed name would silently produce the wrong variable.
// * `os.getenv("X", "fallback")` — the call states TWO possible values and the module cannot say
//   which one runs. Two candidate names is not a name (PRD §35).
// * `os.environ[key]` where `key` is anything but a string literal — nothing is stated.

const OS_MODULE = 'os';

/** True when this module binds `os` by a plain `import os` at top level. */
export const importsOsModule = (root: Node): boolean =>
  namedChildrenOf(root).some(
    (statement) =>
      statement.type === 'import_statement' &&
      namedChildrenOf(statement).some(
        (name) => name.type === 'dotted_name' && name.text === OS_MODULE,
      ),
  );

/** Positional arguments of a call, keyword arguments excluded. */
const positionalArguments = (call: Node): readonly Node[] => {
  const args = fieldNode(call, 'arguments');
  return (args === undefined ? [] : namedChildrenOf(args)).filter(
    (child) => child.type !== 'keyword_argument',
  );
};

const ENV_READERS = new Set(['os.getenv', 'os.environ.get']);

/** `os.getenv("X")` / `os.environ.get("X")` — exactly one argument, and it must be a literal. */
const envReaderCall = (node: Node): string | undefined => {
  const callee = fieldNode(node, 'function');
  const dotted = callee === undefined ? undefined : dottedName(callee);
  if (dotted === undefined || !ENV_READERS.has(dotted)) {
    return undefined;
  }
  const positional = positionalArguments(node);
  const only = positional.length === 1 ? positional[0] : undefined;
  return only === undefined ? undefined : stringLiteralText(only);
};

/** `os.environ["X"]` — the subscript of the `os.environ` mapping, and only a literal one. */
const envSubscript = (node: Node): string | undefined => {
  const value = fieldNode(node, 'value');
  if (value === undefined || dottedName(value) !== 'os.environ') {
    return undefined;
  }
  const subscript = fieldNode(node, 'subscript');
  return subscript === undefined ? undefined : stringLiteralText(subscript);
};

/** The environment variable this expression reads, or undefined for anything else. */
export const envAccessName = (node: Node): string | undefined => {
  if (node.type === 'subscript') {
    return envSubscript(node);
  }
  return node.type === 'call' ? envReaderCall(node) : undefined;
};
