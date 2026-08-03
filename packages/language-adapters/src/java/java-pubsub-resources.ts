import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import type { JavaParseState } from './java-context.js';
import type { Node } from 'web-tree-sitter';

// The naming half of Java Pub/Sub detection (Story 16.3, epic-16): which types are really the
// client library, and which expressions NAME a topic or a subscription. Split out from
// `java-pubsub.ts` so the class-scope pass can build on it without a cycle; the usage half (which
// call counts as a publish or a subscribe) stays there.
//
// Nothing here executes anything and no classpath is consulted — a type is the client's only when
// this compilation unit's own `import` line says so (PRD §35).

/** Packages whose types are the real Pub/Sub clients. Anything else with these names is not. */
const CLIENT_PACKAGES = [
  'com.google.cloud.spring.pubsub', // Spring Cloud GCP 3.x / 4.x
  'org.springframework.cloud.gcp.pubsub', // Spring Cloud GCP 1.x / 2.x
  'com.google.cloud.pubsub.v1', // native client — Publisher, Subscriber
  'com.google.pubsub.v1', // TopicName, ProjectSubscriptionName, ProjectTopicName
] as const;

export type HandleKind = 'topic' | 'subscription';

/** A resource this file NAMED — the only kind that may become a node. */
export interface NamedHandle {
  readonly kind: HandleKind;
  readonly name: string;
}

// Every lookup table here is a `Map`, not an object literal: each key comes from untrusted
// repository text, and an object literal answers `constructor` and `toString` from its prototype
// (PRD §42.5). A method named `toString` must be a miss, not a function.

/** `TopicName.of(project, name)` and friends — the name is the SECOND argument. */
const RESOURCE_NAME_TYPES = new Map<string, HandleKind>([
  ['TopicName', 'topic'],
  ['ProjectTopicName', 'topic'],
  ['ProjectSubscriptionName', 'subscription'],
]);

/** `TopicName.of(project, name)` states the name second. */
const RESOURCE_NAME_ARGUMENT = 1;

/** Was this simple type name imported from a real Pub/Sub client package? */
export const isClientType = (state: JavaParseState, simpleName: string | undefined): boolean => {
  const qualified = simpleName === undefined ? undefined : state.importedTypes.get(simpleName);
  return qualified !== undefined && CLIENT_PACKAGES.some((pkg) => qualified.startsWith(`${pkg}.`));
};

/** True when this compilation unit imports anything from a Pub/Sub client package at all. */
export const importsPubSubClient = (state: JavaParseState): boolean =>
  [...state.importedTypes.keys()].some((name) => isClientType(state, name));

export const stringLiteralValue = (node: Node | undefined): string | undefined => {
  if (node?.type !== 'string_literal') {
    return undefined;
  }
  const fragment = namedChildrenOf(node).find((child) => child.type === 'string_fragment');
  return fragment?.text ?? '';
};

export const argumentsOf = (node: Node): readonly Node[] => {
  const args = fieldNode(node, 'arguments');
  return args === undefined ? [] : namedChildrenOf(args);
};

/**
 * `TopicName.of("deals", "deal-events")` → a named topic handle.
 *
 * The name is read from a fixed position rather than "the last string argument" for the reason the
 * Python detector spells out: `TopicName.of("deals", topicProperty)` states a project and an
 * unknown topic, and taking the last literal would publish the PROJECT name as a topic — a name
 * the source never stated, which would then correlate against a real Terraform resource and look
 * entirely convincing.
 */
export const resourceNameCall = (state: JavaParseState, call: Node): NamedHandle | undefined => {
  const receiver = fieldNode(call, 'object')?.text;
  const kind = receiver === undefined ? undefined : RESOURCE_NAME_TYPES.get(receiver);
  if (
    kind === undefined ||
    fieldNode(call, 'name')?.text !== 'of' ||
    !isClientType(state, receiver)
  ) {
    return undefined;
  }
  const name = stringLiteralValue(argumentsOf(call)[RESOURCE_NAME_ARGUMENT]);
  return name === undefined ? undefined : { kind, name };
};

/**
 * The resource-path string form: `Publisher.newBuilder("projects/deals/topics/deal-events")`.
 *
 * The client's own docs use `TopicName.of(project, topic)`, but the single-string overload is
 * common in configuration-driven code and the grammar is fixed and published, so reading it is
 * parsing rather than a second guess layered on the first. The LAST segment is the name, which is
 * exactly what `TopicName.of` states second — so a Java publisher written this way lands on the
 * same `topic:<name>` node as the Terraform resource, the Python consumer and everything else
 * (§C13). The project segment is deliberately dropped: no other detector carries it, and a node id
 * that sometimes has a project prefix would split the very node this is meant to share.
 *
 * A string that does not match this grammar resolves to nothing. `"deal-events"` alone is NOT read
 * as a topic here: `newBuilder` documents a full resource path, and treating a bare word as one
 * would invent the missing segments.
 */
const RESOURCE_PATH = /^projects\/([^/]+)\/(topics|subscriptions)\/([^/]+)$/;

const PATH_COLLECTION_KIND = new Map<string, HandleKind>([
  ['topics', 'topic'],
  ['subscriptions', 'subscription'],
]);

export const resourcePathHandle = (text: string | undefined): NamedHandle | undefined => {
  const match = text === undefined ? null : RESOURCE_PATH.exec(text);
  if (match === null) {
    return undefined;
  }
  const kind = PATH_COLLECTION_KIND.get(match[2] ?? '');
  const name = match[3];
  return kind === undefined || name === undefined ? undefined : { kind, name };
};

/** Names bound to a `TopicName.of(…)` / `ProjectSubscriptionName.of(…)` value. */
export type HandleScope = ReadonlyMap<string, NamedHandle>;

const MAX_SCOPE_NODES = 2000;

/** `TopicName t = TopicName.of(…), u = …;` — one binding per declarator that names a resource. */
export const bindDeclaratorHandles = (
  state: JavaParseState,
  declaration: Node,
  into: Map<string, NamedHandle>,
): void => {
  for (const declarator of namedChildrenOf(declaration)) {
    const name = fieldNode(declarator, 'name')?.text;
    const value = fieldNode(declarator, 'value');
    const handle = value?.type === 'method_invocation' ? resourceNameCall(state, value) : undefined;
    if (name !== undefined && handle !== undefined) {
      into.set(name, handle);
    }
  }
};

/** Locals of one method body bound to a resource-name call. */
export const handleScopeOf = (state: JavaParseState, body: Node): HandleScope => {
  const handles = new Map<string, NamedHandle>();
  const stack: Node[] = [body];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_SCOPE_NODES) {
    visited += 1;
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.type === 'local_variable_declaration') {
      bindDeclaratorHandles(state, node, handles);
    }
    stack.push(...namedChildrenOf(node));
  }
  return handles;
};
