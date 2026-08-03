import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { declarationEvidence } from './java-context.js';
import { notePackageLocalType } from './java-imports.js';
import { simpleTypeName } from './java-references.js';

import type { JavaParseState } from './java-context.js';
import type { Node } from 'web-tree-sitter';

// Declared types of the names a Java file binds — the bounded resolution Story 16.5 asked for.
//
// `dealService.findAll()` names no type anywhere in the call expression, so binding it needs to
// know what `dealService` IS. Java says so explicitly one declaration away: `private final
// DealService dealService;`, `void f(DealService dealService)`, `DealService s = …`. Reading that
// declaration is parsing, not type inference — there is no overload resolution, no generics
// substitution and no classpath here. A receiver whose declaration this file does not contain
// (a chained call, a `var`, a static import) yields nothing, and the call stays a bare CallFact.
//
// **Block scoping is real here, not flattened** (epic-16). Java's rule is written down in JLS §6.3
// and is entirely positional: a local variable is visible from its declarator to the end of the
// block that immediately contains it; a parameter is visible throughout its method; a field is
// visible throughout its class. Every one of those is a source RANGE, so a binding is a range and
// a lookup is "which binding covering this offset was declared last". No traversal state, no
// push/pop bookkeeping, and no dependence on the order the tree happens to be walked in.
//
// A flattened map got this wrong in exactly one way, and it was not a harmless one: two locals of
// the same name in sibling blocks resolved last-wins, so a call in the FIRST block was attributed
// to the type declared in the SECOND. That is a wrong edge, not a missing one.

/** Declared types visible at a point in the source. */
export interface JavaTypeScope {
  /**
   * The declared type of `name` as seen from source offset `at`, or undefined when this file
   * declares no such name in scope there.
   */
  get(name: string, at: number): string | undefined;
}

/** One name bound to one type over a half-open source range `[from, to)`. */
interface JavaBinding {
  readonly name: string;
  readonly typeName: string;
  readonly from: number;
  readonly to: number;
}

/** Class members are visible throughout the class body, including above their declaration. */
const CLASS_WIDE: Pick<JavaBinding, 'from' | 'to'> = { from: 0, to: Number.MAX_SAFE_INTEGER };

/**
 * Resolution by position. Among the bindings of a name whose range covers the offset, the one
 * declared LAST wins — which is Java's shadowing rule stated in offsets: an inner block's
 * declaration always starts after the outer declaration it shadows, and a local always starts
 * after the parameter or field it shadows.
 */
class PositionalScope implements JavaTypeScope {
  private readonly bindings: readonly JavaBinding[];

  public constructor(bindings: readonly JavaBinding[]) {
    this.bindings = bindings;
  }

  public get(name: string, at: number): string | undefined {
    let best: JavaBinding | undefined;
    for (const binding of this.bindings) {
      const covers = binding.name === name && at >= binding.from && at < binding.to;
      if (covers && (best === undefined || binding.from > best.from)) {
        best = binding;
      }
    }
    return best?.typeName;
  }
}

/** The field bindings of one class body, reused by every member scope built from it. */
export type JavaFieldBindings = readonly JavaBinding[];

/** `receiverName` of the field-type facts this module emits. */
export const FIELD_TYPE_RECEIVER = 'java:field-type';

/** Bound on one method body: a generated file cannot make scope building expensive. */
const MAX_SCOPE_NODES = 2000;

/**
 * `var` is Java's inference keyword, not a type. The grammar reports it in the `type` field like
 * any other type identifier, so it has to be excluded here or `var deals = load()` would bind the
 * name to a "type" called `var` — a target no repository can declare, and a fact stating something
 * the file does not say. Inferring what `var` stands for needs a type checker (PRD §35).
 */
const INFERRED_TYPE = 'var';

const declaredTypeName = (declaration: Node): string | undefined => {
  const type = fieldNode(declaration, 'type');
  const name = type === undefined ? undefined : simpleTypeName(type);
  return name === INFERRED_TYPE ? undefined : name;
};

/** `private final DealService a, b;` binds two names to one type. */
const declaratorNames = (declaration: Node): readonly string[] =>
  namedChildrenOf(declaration)
    .filter((child) => child.type === 'variable_declarator')
    .map((declarator) => fieldNode(declarator, 'name')?.text)
    .filter((name): name is string => name !== undefined);

const bindDeclaration = (
  into: JavaBinding[],
  declaration: Node,
  extent: Pick<JavaBinding, 'from' | 'to'>,
): void => {
  const typeName = declaredTypeName(declaration);
  if (typeName === undefined) {
    return;
  }
  for (const name of declaratorNames(declaration)) {
    into.push({ name, typeName, ...extent });
  }
};

/** Field name → declared type for one class body. Fields are visible to every member. */
export const fieldTypesOf = (body: Node): JavaFieldBindings => {
  const bindings: JavaBinding[] = [];
  for (const member of namedChildrenOf(body)) {
    if (member.type === 'field_declaration') {
      bindDeclaration(bindings, member, CLASS_WIDE);
    }
  }
  return bindings;
};

/**
 * The scope a FIELD INITIALISER sees: the class's own fields and nothing else. A field initialiser
 * has no parameters and no locals, so this is the whole of it (JLS §8.3.2).
 */
export const fieldInitialiserScope = (fields: JavaFieldBindings): JavaTypeScope =>
  new PositionalScope(fields);

/** A parameter is visible for the whole method, body and signature alike. */
const bindParameters = (into: JavaBinding[], declaration: Node): void => {
  const parameters = fieldNode(declaration, 'parameters');
  const extent = { from: declaration.startIndex, to: declaration.endIndex };
  for (const parameter of parameters === undefined ? [] : namedChildrenOf(parameters)) {
    const typeName = declaredTypeName(parameter);
    const name = fieldNode(parameter, 'name')?.text;
    if (typeName !== undefined && name !== undefined) {
      into.push({ name, typeName, ...extent });
    }
  }
};

/**
 * A local's scope ends with the construct that immediately contains its declaration — the
 * enclosing `block` for an ordinary statement, the `for_statement` for a loop's init clause, the
 * `switch_block_statement_group` for a `case` arm. Reading the declaration's PARENT is therefore
 * the scope rule itself, not an approximation of it.
 */
const localExtent = (declaration: Node, body: Node): Pick<JavaBinding, 'from' | 'to'> => ({
  from: declaration.startIndex,
  to: declaration.parent?.endIndex ?? body.endIndex,
});

const bindLocals = (into: JavaBinding[], body: Node): void => {
  const stack: Node[] = [body];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_SCOPE_NODES) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visited += 1;
    if (node.type === 'local_variable_declaration') {
      bindDeclaration(into, node, localExtent(node, body));
    }
    stack.push(...namedChildrenOf(node));
  }
};

/**
 * The scope one method body sees: the class's fields, its own parameters, and every local it
 * declares — each carrying the source range over which Java says it is visible. Lookups are by
 * position, so a shadowed name resolves to the declaration that actually governs the call site.
 */
export const methodScope = (fields: JavaFieldBindings, declaration: Node): JavaTypeScope => {
  const bindings: JavaBinding[] = [...fields];
  bindParameters(bindings, declaration);
  const body = fieldNode(declaration, 'body');
  if (body !== undefined) {
    bindLocals(bindings, body);
  }
  return new PositionalScope(bindings);
};

/**
 * Record what a field is declared as, on the language-neutral CallFact channel (PRD §31).
 *
 * This is a plain parsed fact — "field `dealService` of `DealController` is declared
 * `DealService`" — with no opinion about who assigns it. Whether an annotation makes it an
 * injection point is Spring's reading, and lives in packages/framework-adapters.
 */
export const recordFieldTypes = (
  state: JavaParseState,
  declaration: Node,
  classNodeId: string,
): void => {
  const type = fieldNode(declaration, 'type');
  const typeName = type === undefined ? undefined : simpleTypeName(type);
  if (type === undefined || typeName === undefined) {
    return;
  }
  const evidenceId = declarationEvidence(state, type, typeName);
  if (evidenceId === undefined) {
    return;
  }
  notePackageLocalType(state, typeName, type);
  for (const name of declaratorNames(declaration)) {
    state.builder.addCallFact({
      filePath: state.filePath,
      assignedTo: name,
      receiverName: FIELD_TYPE_RECEIVER,
      calleeName: typeName,
      stringArguments: [],
      identifierArguments: [],
      enclosingSymbolNodeId: classNodeId,
      evidenceId,
    });
  }
};
