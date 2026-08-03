import ts from 'typescript';

// Which local names in one file are bound to `@google-cloud/pubsub` — the gate `parse-pubsub.ts`
// opens before it reads a single `.topic(…)` call.
//
// The whole detector rests on one claim: **the import proves the identity**. A local `./pubsub`
// helper that happens to export a `PubSub` class is not this library and never matches, because
// the module specifier is the evidence, not the name. That is why the binding step lives in its
// own module: it is the only place where "is this the client library?" is decided.
//
// Two module systems state the same binding, so both are read (epic-16, Story 16.3):
//
//   import { PubSub } from '@google-cloud/pubsub'      const { PubSub } = require('@google-cloud/pubsub')
//   import pubsub from '@google-cloud/pubsub'          const pubsub = require('@google-cloud/pubsub')
//   import * as pubsub from '@google-cloud/pubsub'
//
// CommonJS is not "ESM with different syntax" in one respect that matters here: `require(m)`
// evaluates to the module's exports OBJECT, so `const pubsub = require(m)` binds a namespace and
// `new pubsub()` is not a thing anyone writes. It is therefore recorded as a namespace, not as a
// constructor — while `import pubsub from m` keeps its historical constructor binding, because a
// default import of a CJS module under `esModuleInterop` genuinely can be the callable.

const CLIENT_MODULE = '@google-cloud/pubsub';

/** The one class this library exports as its entry point — the only `ns.X` worth resolving. */
const CLIENT_CLASS = 'PubSub';

/**
 * Local names bound to the client library, split by what they can be used AS.
 *
 * `constructors` answer `new X()`; `namespaces` answer `new X.PubSub()`. Nothing else is derived
 * from an import — a name bound here still has to be used in a shape the detector recognizes.
 */
export interface ClientBindings {
  readonly constructors: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

interface MutableBindings {
  readonly constructors: Set<string>;
  readonly namespaces: Set<string>;
}

const isClientModuleSpecifier = (node: ts.Expression | undefined): boolean =>
  node !== undefined && ts.isStringLiteralLike(node) && node.text === CLIENT_MODULE;

const readImport = (into: MutableBindings, statement: ts.ImportDeclaration): void => {
  const clause = statement.importClause;
  if (clause === undefined || !isClientModuleSpecifier(statement.moduleSpecifier)) {
    return;
  }
  if (clause.name !== undefined) {
    into.constructors.add(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    into.namespaces.add(bindings.name.text);
    return;
  }
  for (const element of bindings.elements) {
    into.constructors.add(element.name.text);
  }
};

/** `require('@google-cloud/pubsub')` and nothing else — a computed specifier states no module. */
const isClientRequire = (initializer: ts.Expression | undefined): boolean =>
  initializer !== undefined &&
  ts.isCallExpression(initializer) &&
  ts.isIdentifier(initializer.expression) &&
  initializer.expression.text === 'require' &&
  initializer.arguments.length > 0 &&
  isClientModuleSpecifier(initializer.arguments[0]);

/**
 * `const { PubSub } = require(m)` / `const { PubSub: Client } = require(m)`.
 *
 * The LOCAL name is what the rest of the file says, so that is what is bound — the same
 * convention `import { PubSub as Client }` already follows. A rest element (`const { ...rest }`)
 * binds an object, not a class, and is skipped rather than guessed at.
 */
const readDestructuring = (into: MutableBindings, pattern: ts.ObjectBindingPattern): void => {
  for (const element of pattern.elements) {
    if (ts.isIdentifier(element.name) && element.dotDotDotToken === undefined) {
      into.constructors.add(element.name.text);
    }
  }
};

const readRequire = (into: MutableBindings, declaration: ts.VariableDeclaration): void => {
  if (!isClientRequire(declaration.initializer)) {
    return;
  }
  if (ts.isIdentifier(declaration.name)) {
    into.namespaces.add(declaration.name.text);
    return;
  }
  if (ts.isObjectBindingPattern(declaration.name)) {
    readDestructuring(into, declaration.name);
  }
};

/**
 * Every local name this file binds to the client library.
 *
 * `require` is looked for at any depth, not just at module level: a conditional or lazily-loaded
 * `const { PubSub } = require(…)` inside a function is ordinary CommonJS and binds exactly the
 * same handle. Reading the tree is not running it (PRD §35), and a name that is never used in a
 * recognized shape produces nothing.
 */
export const clientBindings = (source: ts.SourceFile): ClientBindings => {
  const into: MutableBindings = { constructors: new Set(), namespaces: new Set() };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      readImport(into, statement);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      readRequire(into, node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return into;
};

/** True when `new <expression>()` constructs a client, given what this file imported. */
export const isClientConstruction = (
  bindings: ClientBindings,
  expression: ts.Expression,
): boolean => {
  if (ts.isIdentifier(expression)) {
    return bindings.constructors.has(expression.text);
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text) &&
    expression.name.text === CLIENT_CLASS
  );
};

/** Nothing in this file mentions the client library — the caller can stop immediately. */
export const bindsNothing = (bindings: ClientBindings): boolean =>
  bindings.constructors.size === 0 && bindings.namespaces.size === 0;
