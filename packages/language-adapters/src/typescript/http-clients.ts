import ts from 'typescript';

// Which local names in one file ARE an HTTP client — the question the previous pass declined to
// answer, on the grounds that proving it needs type resolution.
//
// It does not, for the case that matters: **the import proves the identity**. `import axios from
// 'axios'` states that the name `axios` is the axios module; nothing about the call site has to be
// inferred, and no type checker is consulted. This is the same evidence `pubsub-bindings.ts` uses
// for `@google-cloud/pubsub` and `state.importedTypes` uses in the Java adapter — a module
// specifier is a fact the file states.
//
// What is bound, and nothing else:
//
//   import axios from 'axios'            const axios = require('axios')      → the module
//   const api = axios.create({...})                                          → an axios instance
//   import { $fetch } from 'ofetch'      import { ofetch } from 'ofetch'     → a request function
//   import $fetch from 'ofetch'          const { $fetch } = require('ofetch')
//
// Deliberately NOT bound, because the import proves nothing about them:
//
// * A WRAPPED client — `apiClient.get('/api/deals')` where `apiClient` is `./lib/api-client.js`.
//   The import proves the name comes from a local module; it does not prove that module wraps an
//   HTTP client rather than a database, a cache or a queue. Following it would need cross-file
//   type resolution (PRD §35), so these stay undetected and the limitation is stated rather than
//   approximated.
// * Nuxt's auto-imported global `$fetch`, which has no import statement to prove anything.
// * `axios.request(config)` and `instance({ url })` — the URL is a property of an object literal,
//   which is a different extraction from "the first argument", and rare enough not to guess at.

/** Modules whose default/whole-module binding IS the axios request object. */
const AXIOS_MODULE = 'axios';

/** Modules exporting a callable request function, and the export names that are one. */
const CALLABLE_MODULE = 'ofetch';
const CALLABLE_EXPORTS = new Set(['ofetch', '$fetch', 'default']);

/** The axios factory that produces another axios — provably still axios, so still bound. */
const INSTANCE_FACTORY = 'create';

export interface HttpClientBindings {
  /** Names bound to the axios module, or to an `axios.create()` instance of it. */
  readonly axios: ReadonlySet<string>;
  /** Names bound to a callable request function taking `(url, options)`. */
  readonly callables: ReadonlySet<string>;
}

interface MutableBindings {
  readonly axios: Set<string>;
  readonly callables: Set<string>;
}

const specifierOf = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;

const namedImportInto = (
  into: MutableBindings,
  bindings: ts.NamedImports,
  module: string,
): void => {
  for (const element of bindings.elements) {
    const exported = (element.propertyName ?? element.name).text;
    if (module === CALLABLE_MODULE && CALLABLE_EXPORTS.has(exported)) {
      into.callables.add(element.name.text);
    }
    if (module === AXIOS_MODULE && exported === 'default') {
      into.axios.add(element.name.text);
    }
  }
};

const readImport = (into: MutableBindings, statement: ts.ImportDeclaration): void => {
  const module = specifierOf(statement.moduleSpecifier);
  const clause = statement.importClause;
  if (module === undefined || clause === undefined) {
    return;
  }
  if (clause.name !== undefined && module === AXIOS_MODULE) {
    into.axios.add(clause.name.text);
  }
  if (clause.name !== undefined && module === CALLABLE_MODULE) {
    into.callables.add(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    namedImportInto(into, bindings, module);
  }
};

/** `require('<module>')` with a literal specifier; a computed one states no module. */
const requiredModule = (initializer: ts.Expression | undefined): string | undefined => {
  if (
    initializer === undefined ||
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'require'
  ) {
    return undefined;
  }
  return specifierOf(initializer.arguments[0]);
};

/** `const { $fetch } = require('ofetch')` — the LOCAL name binds, the exported one gates. */
const readRequiredDestructuring = (
  into: MutableBindings,
  pattern: ts.ObjectBindingPattern,
): void => {
  for (const element of pattern.elements) {
    const exported = element.propertyName ?? element.name;
    if (!ts.isIdentifier(element.name) || !ts.isIdentifier(exported)) {
      continue;
    }
    if (CALLABLE_EXPORTS.has(exported.text)) {
      into.callables.add(element.name.text);
    }
  }
};

const readRequire = (into: MutableBindings, declaration: ts.VariableDeclaration): void => {
  const module = requiredModule(declaration.initializer);
  if (module === undefined) {
    return;
  }
  if (ts.isIdentifier(declaration.name)) {
    (module === AXIOS_MODULE ? into.axios : into.callables).add(declaration.name.text);
    return;
  }
  if (ts.isObjectBindingPattern(declaration.name) && module === CALLABLE_MODULE) {
    readRequiredDestructuring(into, declaration.name);
  }
};

/** The receiver of a `<name>.create(…)` initializer, if that is what this declaration is. */
const factoryReceiver = (initializer: ts.Expression | undefined): string | undefined => {
  if (initializer === undefined || !ts.isCallExpression(initializer)) {
    return undefined;
  }
  const callee = initializer.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== INSTANCE_FACTORY) {
    return undefined;
  }
  return ts.isIdentifier(callee.expression) ? callee.expression.text : undefined;
};

/** `const api = axios.create({ baseURL })` — still axios, and provably so from this file alone. */
const readInstance = (into: MutableBindings, declaration: ts.VariableDeclaration): void => {
  const receiver = factoryReceiver(declaration.initializer);
  if (receiver !== undefined && ts.isIdentifier(declaration.name) && into.axios.has(receiver)) {
    into.axios.add(declaration.name.text);
  }
};

/**
 * Every local name this file binds to an HTTP client.
 *
 * Two passes over the variable declarations, because `const api = axios.create(…)` can only be
 * recognized once `axios` itself is bound, and a `require` may sit below the line that uses it.
 */
export const httpClientBindings = (source: ts.SourceFile): HttpClientBindings => {
  const into: MutableBindings = { axios: new Set(), callables: new Set() };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      readImport(into, statement);
    }
  }
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  for (const declaration of declarations) {
    readRequire(into, declaration);
  }
  for (const declaration of declarations) {
    readInstance(into, declaration);
  }
  return into;
};

/** The one global that needs no import: `fetch` is same-origin by definition in a browser. */
export const GLOBAL_CALLABLES = new Set(['fetch']);

/** Verb-per-method on the axios request object; `axios(url, config)` states its verb in config. */
export const AXIOS_VERB_METHODS = new Map<string, string>([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
]);
