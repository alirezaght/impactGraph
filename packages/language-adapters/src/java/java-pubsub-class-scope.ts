import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { argumentsOf, bindDeclaratorHandles } from './java-pubsub-resources.js';

import type { JavaParseState } from './java-context.js';
import type { HandleScope, NamedHandle } from './java-pubsub-resources.js';
import type { Node } from 'web-tree-sitter';

// What one Java CLASS BODY says about Pub/Sub before any of its methods are read (epic-16):
// resources named in field initialisers, and getters that are plainly a field.
//
// AMBIGUITY, and why Java needs no sentinel for it. The TypeScript and Python detectors keep field
// handles in a FILE-scoped map, because neither language hands the parser a class boundary it can
// trust: `this.x` / `self.x` may be assigned in a constructor, a method, a mixin. When two classes
// in one file disagree about a name, those maps collapse the entry and resolve to nothing.
//
// Java states the boundary outright. A field belongs to the `class_body` that declares it, the
// declarations pass already walks one class body at a time, and this scope is built from THAT body
// and handed only to that class's members. Two classes in one file therefore never share an entry
// to disagree about — each resolves its own fields, and neither can reach the other's. That is the
// same rule the other two enforce ("never guess which class a reference meant"), enforced by
// construction instead of by a sentinel, and it is why the two-class test in `java-pubsub.test.ts`
// asserts that each class resolves to ITS OWN topic rather than to nothing.
//
// Nested classes are not members here: `java-declarations.ts` records only methods, constructors
// and fields, so a nested type contributes nothing to its outer class's scope.

/** Everything a class body states about Pub/Sub, visible to every member it declares. */
export interface JavaPubSubClassScope {
  /** Field name → the topic/subscription its initialiser names. */
  readonly handles: HandleScope;
  /** Getter method name → the field it plainly returns. */
  readonly getters: ReadonlyMap<string, string>;
}

const isComment = (node: Node): boolean => node.type.endsWith('comment');

const bodyStatements = (declaration: Node): readonly Node[] => {
  const body = fieldNode(declaration, 'body');
  return body === undefined ? [] : namedChildrenOf(body).filter((child) => !isComment(child));
};

/** `this.template` and a bare `template` both name a field; anything else names nothing. */
const returnedFieldName = (value: Node): string | undefined => {
  if (value.type === 'identifier') {
    return value.text;
  }
  return value.type === 'field_access' && fieldNode(value, 'object')?.type === 'this'
    ? fieldNode(value, 'field')?.text
    : undefined;
};

/**
 * The field a zero-argument getter plainly returns — `return this.template;` or `return template;`
 * and nothing else.
 *
 * Anything with more in it resolves to nothing, deliberately: a computed return
 * (`return template != null ? template : fallback();`) states no single field, an abstract or
 * interface method has no body to read, and a getter inherited from a superclass is not in this
 * compilation unit at all. Each of those would need a value this file does not contain, and
 * guessing one attaches a publish to a template the class may never hold (PRD §35).
 */
const plainFieldGetter = (method: Node, fields: ReadonlySet<string>): string | undefined => {
  const parameters = fieldNode(method, 'parameters');
  if (parameters === undefined || namedChildrenOf(parameters).length > 0) {
    return undefined;
  }
  const statements = bodyStatements(method);
  const only = statements.length === 1 ? statements[0] : undefined;
  const value = only?.type === 'return_statement' ? namedChildrenOf(only)[0] : undefined;
  const field = value === undefined ? undefined : returnedFieldName(value);
  return field !== undefined && fields.has(field) ? field : undefined;
};

const declaredFieldNames = (body: Node): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const member of namedChildrenOf(body)) {
    if (member.type !== 'field_declaration') {
      continue;
    }
    for (const declarator of namedChildrenOf(member)) {
      const name = fieldNode(declarator, 'name')?.text;
      if (declarator.type === 'variable_declarator' && name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
};

/**
 * Read one class body's Pub/Sub scope.
 *
 * A `Map` for the getters, not an object literal: the key is a method name straight out of
 * repository text, and a method literally called `constructor` must be a miss (PRD §42.5).
 */
export const pubSubClassScope = (state: JavaParseState, body: Node): JavaPubSubClassScope => {
  const handles = new Map<string, NamedHandle>();
  const getters = new Map<string, string>();
  const fields = declaredFieldNames(body);
  for (const member of namedChildrenOf(body)) {
    if (member.type === 'field_declaration') {
      bindDeclaratorHandles(state, member, handles);
      continue;
    }
    const name = member.type === 'method_declaration' ? fieldNode(member, 'name')?.text : undefined;
    const field = name === undefined ? undefined : plainFieldGetter(member, fields);
    if (name !== undefined && field !== undefined) {
      getters.set(name, field);
    }
  }
  return { handles, getters };
};

/**
 * `getPubSubTemplate()` / `this.getPubSubTemplate()` → the field it returns.
 *
 * A receiver-qualified getter (`other.getPubSubTemplate()`) is somebody else's field and resolves
 * to nothing, and so does a getter with arguments — the map only holds zero-argument ones.
 */
export const getterField = (
  invocation: Node,
  getters: ReadonlyMap<string, string>,
): string | undefined => {
  const receiver = fieldNode(invocation, 'object');
  if ((receiver !== undefined && receiver.type !== 'this') || argumentsOf(invocation).length > 0) {
    return undefined;
  }
  const name = fieldNode(invocation, 'name')?.text;
  return name === undefined ? undefined : getters.get(name);
};
