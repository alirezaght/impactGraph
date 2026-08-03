import { fieldNode } from '../tree-sitter/syntax.js';

import type { Node } from 'web-tree-sitter';

// `self.<name>` handles for `python-pubsub.ts` (epic-16, Story 16.3) — the Python mirror of the
// instance-field map in `typescript/parse-pubsub.ts`, and it follows the same discipline for the
// same reason.
//
// Attributes live in a map SEPARATE from module/local names. A module-level `publisher` and an
// instance attribute `self.publisher` are different bindings; merging them would let either shadow
// the other, so a class that assigns `self.publisher = something_else` could silently inherit the
// module's client.
//
// This map is FILE-scoped while attributes are class-scoped, and Python offers no way to close that
// gap by parsing alone: `self` is just the first parameter of a method, and which class a `self.x`
// belongs to is only knowable by walking up to the enclosing `class_definition` — which the
// resolver deliberately does not do, because the same attribute name may then be assigned in a
// base class, a mixin, or a helper in another module. So when two classes in one file assign the
// same attribute name DIFFERENT handles, the entry collapses to AMBIGUOUS and resolves to nothing.
// Refusing is always correct; guessing which class a `self.` reference meant is not.
//
// Python has no `private` and no declaration site, so an attribute assigned outside `__init__` is
// an ordinary assignment and is read exactly the same way. A class-level attribute
// (`class C: publisher = pubsub_v1.PublisherClient()`) is reachable as `self.publisher` too, so it
// is recorded here as well as in the module scope.

/** What a Pub/Sub expression evaluates to. Shared by the module-scope and attribute resolvers. */
export interface PubSubHandle {
  readonly kind: 'client' | 'topic' | 'subscription';
  /** The declared name, for a topic or subscription handle built from a stated string. */
  readonly name?: string;
  /** The environment variable the name is read from, when the module states one instead. */
  readonly envName?: string;
}

/** An attribute whose handle two classes in one file disagree about — resolvable by nobody. */
const AMBIGUOUS = Symbol('ambiguous-attribute');

export type AttributeHandles = Map<string, PubSubHandle | typeof AMBIGUOUS>;

export const createAttributeHandles = (): AttributeHandles => new Map();

const SELF = 'self';
const SELF_PREFIX = `${SELF}.`;

/**
 * `self.publisher` → 'publisher'; anything else → undefined.
 *
 * A deeper path (`self.a.b`) names an attribute of an attribute, which this adapter does not
 * resolve, and `cls.x` is a class-method reference whose binding is a different question again.
 */
export const selfAttributeName = (dotted: string): string | undefined => {
  if (!dotted.startsWith(SELF_PREFIX)) {
    return undefined;
  }
  const attribute = dotted.slice(SELF_PREFIX.length);
  return attribute.length > 0 && !attribute.includes('.') ? attribute : undefined;
};

/** `self.publisher = …` → 'publisher'. A subscript or a deeper path names nothing here. */
export const selfAttributeTarget = (target: Node): string | undefined => {
  if (target.type !== 'attribute') {
    return undefined;
  }
  const object = fieldNode(target, 'object');
  const attribute = fieldNode(target, 'attribute');
  return object?.type === 'identifier' && object.text === SELF && attribute !== undefined
    ? attribute.text
    : undefined;
};

/** True when this assignment is a direct statement of a `class X:` body. */
export const isClassBodyAssignment = (assignment: Node): boolean => {
  const parent = assignment.parent ?? undefined;
  const block = parent?.type === 'expression_statement' ? (parent.parent ?? undefined) : parent;
  return block?.type === 'block' && block.parent?.type === 'class_definition';
};

const sameHandle = (left: PubSubHandle, right: PubSubHandle): boolean =>
  left.kind === right.kind && left.name === right.name && left.envName === right.envName;

/** Record an attribute handle, collapsing to AMBIGUOUS when a second class disagrees. */
export const recordAttribute = (
  into: AttributeHandles,
  name: string,
  handle: PubSubHandle,
): void => {
  const existing = into.get(name);
  if (existing === undefined) {
    into.set(name, handle);
    return;
  }
  if (existing === AMBIGUOUS || !sameHandle(existing, handle)) {
    into.set(name, AMBIGUOUS);
  }
};

/** The handle an attribute holds, or undefined when unknown or ambiguous across classes. */
export const attributeHandle = (from: AttributeHandles, name: string): PubSubHandle | undefined => {
  const held = from.get(name);
  return held === undefined || held === AMBIGUOUS ? undefined : held;
};
