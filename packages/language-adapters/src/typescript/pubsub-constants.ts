import ts from 'typescript';

// String constants one file states outright — the only non-literal topic name `parse-pubsub.ts` is
// allowed to read (epic-16, Story 16.3).
//
// `const TOPIC = 'deal-events'; pubsub.topic(TOPIC)` is not a guess: the module states the value on
// the line above, and a reviewer opening the evidence sees it. That makes it a STATED name, unlike
// `process.env.TOPIC` or a function parameter, where the repository does not contain the value at
// all and §35 forbids inventing one. The whole difference between the two is decided here, so the
// rule is deliberately narrow:
//
// * `const` only, with a string-literal (or hole-free template) initialiser, in THIS file.
// * A name this file binds any other way — `let`, a non-literal initialiser, a destructuring, an
//   import, a function parameter, an assignment anywhere — collapses to AMBIGUOUS and resolves to
//   nothing. This is the same discipline the instance-field map uses: a map keyed by name is
//   file-scoped while the bindings it records are not, so the moment two bindings of one name
//   disagree, the honest answer is silence rather than whichever was seen last.
//
// A parameter is the case that makes the collapse load-bearing rather than theoretical:
// `const TOPIC = 'a'` at module level and `function f(TOPIC: string) { pubsub.topic(TOPIC) }` in
// the same file must publish nothing, because the call site reads the parameter.

/** A name two bindings of this file disagree about — resolvable by nobody. */
const AMBIGUOUS = Symbol('ambiguous-constant');

type Binding = string | typeof AMBIGUOUS;

/** Name → the string value this file states for it. Only unambiguous entries survive. */
export type StringConstants = ReadonlyMap<string, string>;

/**
 * A literal whose whole value is in the source. A template WITH a hole is excluded: its
 * `.text` would be a fragment, and reporting a prefix as the value is exactly the invented fact
 * `parse-pubsub.ts` refuses everywhere else.
 */
const statedString = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const record = (into: Map<string, Binding>, name: string, value: Binding): void => {
  const existing = into.get(name);
  into.set(name, existing === undefined || existing === value ? value : AMBIGUOUS);
};

/** Every identifier a binding pattern introduces — all of them unknowable, none of them read. */
const markPattern = (into: Map<string, Binding>, pattern: ts.BindingName): void => {
  if (ts.isIdentifier(pattern)) {
    record(into, pattern.text, AMBIGUOUS);
    return;
  }
  for (const element of pattern.elements) {
    if (!ts.isOmittedExpression(element)) {
      markPattern(into, element.name);
    }
  }
};

const isConst = (declaration: ts.VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(declaration.parent) &&
  (declaration.parent.flags & ts.NodeFlags.Const) !== 0;

const readDeclaration = (into: Map<string, Binding>, declaration: ts.VariableDeclaration): void => {
  if (!ts.isIdentifier(declaration.name)) {
    markPattern(into, declaration.name);
    return;
  }
  const value = isConst(declaration) ? statedString(declaration.initializer) : undefined;
  record(into, declaration.name.text, value ?? AMBIGUOUS);
};

/** `x = …`, `x += …` — a reassigned name states nothing stable, whatever it was declared as. */
/**
 * The name an assignment target ultimately writes to, through the wrappers that change nothing at
 * runtime. Repository content is untrusted and need not even be valid TypeScript (§42.5), so
 * `(TOPIC as string) = 'other'` has to count as a write exactly as `TOPIC = 'other'` does.
 */
const assignedName = (node: ts.Expression): string | undefined => {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return assignedName(node.expression);
  }
  return ts.isIdentifier(node) ? node.text : undefined;
};

const reassignedName = (node: ts.Node): string | undefined => {
  if (!ts.isBinaryExpression(node)) {
    return undefined;
  }
  const operator = node.operatorToken.kind;
  return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment
    ? assignedName(node.left)
    : undefined;
};

/** A name another module owns. This file cannot see its value, so it must not claim one. */
const importedName = (node: ts.Node): string | undefined => {
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
    return node.name.text;
  }
  return ts.isImportClause(node) ? node.name?.text : undefined;
};

const visitNode = (into: Map<string, Binding>, node: ts.Node): void => {
  if (ts.isVariableDeclaration(node)) {
    readDeclaration(into, node);
    return;
  }
  if (ts.isParameter(node)) {
    markPattern(into, node.name);
    return;
  }
  const shadowed = importedName(node) ?? reassignedName(node);
  if (shadowed !== undefined) {
    record(into, shadowed, AMBIGUOUS);
  }
};

/**
 * Every string constant this file states unambiguously. Reading declarations is parsing; nothing
 * is evaluated and no other module is consulted (PRD §35).
 */
export const stringConstants = (source: ts.SourceFile): StringConstants => {
  const bindings = new Map<string, Binding>();
  const visit = (node: ts.Node): void => {
    visitNode(bindings, node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  const stated = new Map<string, string>();
  for (const [name, value] of bindings) {
    if (typeof value === 'string') {
      stated.set(name, value);
    }
  }
  return stated;
};
