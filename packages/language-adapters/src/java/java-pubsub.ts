import { deterministicEnvelope } from '../fragment-builder.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { callSiteEvidence } from './java-context.js';
import { getterField } from './java-pubsub-class-scope.js';
import { noteUnresolvedName } from './java-pubsub-config.js';
import {
  argumentsOf,
  isClientType,
  resourceNameCall,
  resourcePathHandle,
  stringLiteralValue,
} from './java-pubsub-resources.js';

import type { JavaParseState } from './java-context.js';
import type { JavaPubSubClassScope } from './java-pubsub-class-scope.js';
import type { HandleKind, HandleScope, NamedHandle } from './java-pubsub-resources.js';
import type { JavaTypeScope } from './java-types.js';
import type { Node } from 'web-tree-sitter';

// Story 16.3 — Pub/Sub client usage in Java (PRD §15.2, epic-16 line 202). The third language to
// join `typescript/parse-pubsub.ts` and `python/python-pubsub.ts`, and it agrees with both on the
// two things that make multi-stack analysis work (§C13):
//
// * NODE IDS. `topic:<name>` / `subscription:<name>` in the `integration` category, exactly as the
//   other two emit them. A Java publisher and a Python consumer of `deal-events` are therefore ONE
//   node, and the cross-stack adapter cannot tell which language produced it — it must not be able
//   to, or the correlation would become language-specific.
// * PROVENANCE. `framework-convention` on every node and every edge, never `static-analysis`.
//   The string literal is genuinely parsed, but "the first argument of `PubSubTemplate.publish` is
//   a topic name" is knowledge about a library, not something the source states. §12.3's
//   deterministic `framework-convention` category is precisely that case. Evidence is the parsed
//   call site, so a reviewer can open the line and check the claim.
//
// The gate is an IMPORT of a real client package, checked per type name in
// `java-pubsub-resources.ts` — a local class called `Publisher` never matches. Nothing is executed
// and no classpath is consulted (PRD §35).
//
// Reached in epic-16, each through the class scope in `java-pubsub-class-scope.ts` rather than by
// guessing: field initialisers (`private final Publisher p = Publisher.newBuilder(…)`, whose facts
// hang off the field's own symbol node), a template reached through a getter that is plainly a
// field return, and the `Publisher.newBuilder("projects/p/topics/t")` resource-path string form.
//
// A name this compilation unit does not state is never invented here. Where the argument is a
// plain identifier, `java-pubsub-config.ts` records the IDENTIFIER — not a topic name — so that
// `@Value("${deals.topic}")` can be resolved against the module's own `application.yml` by the
// Spring framework adapter, which is the only component that sees both files. A name the
// repository states nowhere still resolves to nothing (§35).
//
// Deliberately NOT detected, rather than guessed:
// * A resource name that is not a literal and not a plain identifier — a concatenation, a method
//   call, a ternary. Nothing is stated and nothing is recorded.
// * `Publisher.newBuilder(x)` and `new PubSubInboundChannelAdapter(t, x)` with a non-literal `x`
//   warn but record no identifier: the builder takes a `TopicName`, not a `@Value` String, and the
//   inbound-adapter case has no fixture yet. Both stay warnings until one exists.
// * A getter that is anything but `return this.<field>;` / `return <field>;` in this compilation
//   unit — see `java-pubsub-class-scope.ts` for why each excluded shape is excluded.

// Every lookup table here is a `Map`, not an object literal: each key comes from untrusted
// repository text, and an object literal answers `constructor` and `toString` from its prototype
// (PRD §42.5). A method named `toString` must be a miss, not a function.

/** `PubSubTemplate` methods that name a topic or a subscription in their first argument. */
const TEMPLATE_METHODS = new Map<string, HandleKind>([
  ['publish', 'topic'],
  ['subscribe', 'subscription'],
  ['subscribeAndConvert', 'subscription'],
  ['pull', 'subscription'],
  ['pullNext', 'subscription'],
  ['pullAndAck', 'subscription'],
  ['pullAndConvert', 'subscription'],
]);

/** Spring Integration endpoints whose SECOND constructor argument names the resource. */
const ADAPTER_TYPES = new Map<string, HandleKind>([
  ['PubSubInboundChannelAdapter', 'subscription'],
  ['PubSubMessageHandler', 'topic'],
]);

/** `Publisher.newBuilder(x)` / `Subscriber.newBuilder(x, receiver)` — x names the resource. */
const BUILDER_TYPES = new Map<string, HandleKind>([
  ['Publisher', 'topic'],
  ['Subscriber', 'subscription'],
]);

const EDGE_TYPE = new Map<HandleKind, string>([
  ['topic', 'PUBLISHES'],
  ['subscription', 'SUBSCRIBES_TO'],
]);

const TEMPLATE_TYPE = 'PubSubTemplate';

interface Detection {
  readonly state: JavaParseState;
  readonly scope: JavaTypeScope;
  readonly handles: HandleScope;
  readonly getters: ReadonlyMap<string, string>;
}

/** The scope one member sees: its class's Pub/Sub facts, plus whatever its own body declares. */
export const detectionFor = (
  state: JavaParseState,
  scope: JavaTypeScope,
  classScope: JavaPubSubClassScope,
  locals: HandleScope,
): Detection => ({
  state,
  scope,
  // A local shadows a field of the same name, which is Java's own rule.
  handles: new Map([...classScope.handles, ...locals]),
  getters: classScope.getters,
});

/**
 * The variable a call's receiver names: `pubSubTemplate`, `this.pubSubTemplate`, or the field a
 * plain getter returns. Anything else — a chained call, another object's field — names nothing.
 */
const receiverVariable = (detection: Detection, invocation: Node): string | undefined => {
  const object = fieldNode(invocation, 'object');
  if (object === undefined) {
    return undefined;
  }
  return object.type === 'method_invocation'
    ? getterField(object, detection.getters)
    : object.text.replace(/^this\./, '');
};

/** `pubSubTemplate.publish("deal-events", payload)` — the receiver's declared type decides. */
const templateUsage = (
  detection: Detection,
  call: Node,
  sourceId: string,
): NamedHandle | undefined => {
  const method = fieldNode(call, 'name')?.text;
  const kind = method === undefined ? undefined : TEMPLATE_METHODS.get(method);
  const variable = receiverVariable(detection, call);
  const declaredType =
    variable === undefined ? undefined : detection.scope.get(variable, call.startIndex);
  if (kind === undefined || declaredType !== TEMPLATE_TYPE) {
    return undefined;
  }
  if (!isClientType(detection.state, TEMPLATE_TYPE)) {
    return undefined;
  }
  const name = stringLiteralValue(argumentsOf(call)[0]);
  if (name === undefined) {
    noteUnresolvedName(detection.state, {
      call,
      kind,
      argument: argumentsOf(call)[0],
      description: `${TEMPLATE_TYPE}.${method ?? ''}`,
      sourceId,
    });
    return undefined;
  }
  return { kind, name };
};

/** `Publisher.newBuilder(TopicName.of(…))` / `Subscriber.newBuilder(subscriptionName, …)`. */
const builderUsage = (detection: Detection, call: Node): NamedHandle | undefined => {
  const receiver = fieldNode(call, 'object')?.text;
  const kind = receiver === undefined ? undefined : BUILDER_TYPES.get(receiver);
  const isBuilder = fieldNode(call, 'name')?.text === 'newBuilder';
  if (kind === undefined || !isBuilder || !isClientType(detection.state, receiver)) {
    return undefined;
  }
  const handle = resolveResourceArgument(detection, argumentsOf(call)[0]);
  if (handle === undefined) {
    detection.state.builder.warn(
      detection.state.filePath,
      `${receiver ?? ''}.newBuilder was given a ${kind} this file does not name literally — ` +
        'no node was created (PRD §35)',
    );
    return undefined;
  }
  // `Subscriber.newBuilder(topicName, …)` is a compile error upstream; if the shapes disagree,
  // this adapter reports nothing rather than relabel what the source said.
  return handle.kind === kind ? handle : undefined;
};

/** A resource named inline, held in a local or field, or written as a full resource path. */
const resolveResourceArgument = (
  detection: Detection,
  argument: Node | undefined,
): NamedHandle | undefined => {
  if (argument === undefined) {
    return undefined;
  }
  if (argument.type === 'identifier') {
    return detection.handles.get(argument.text);
  }
  if (argument.type === 'string_literal') {
    return resourcePathHandle(stringLiteralValue(argument));
  }
  return argument.type === 'method_invocation'
    ? resourceNameCall(detection.state, argument)
    : undefined;
};

/** `new PubSubInboundChannelAdapter(template, "deal-events-worker")`. */
export const adapterConstruction = (
  state: JavaParseState,
  creation: Node,
): NamedHandle | undefined => {
  const typeName = fieldNode(creation, 'type')?.text;
  const kind = typeName === undefined ? undefined : ADAPTER_TYPES.get(typeName);
  if (kind === undefined || !isClientType(state, typeName)) {
    return undefined;
  }
  const name = stringLiteralValue(argumentsOf(creation)[1]);
  if (name === undefined) {
    state.builder.warn(
      state.filePath,
      `${typeName ?? ''} was constructed with a ${kind} name this file does not state literally ` +
        '— no node was created (PRD §35)',
    );
    return undefined;
  }
  return { kind, name };
};

/** Emit the shared integration node for a handle, once per file. Returns its id. */
export const emitHandleNode = (
  state: JavaParseState,
  handle: NamedHandle,
  evidenceId: string,
): string => {
  const nodeId = `${handle.kind}:${handle.name}`;
  if (!state.emittedIntegrationFacts.has(nodeId)) {
    state.emittedIntegrationFacts.add(nodeId);
    state.builder.addNode(
      {
        id: nodeId,
        category: 'integration',
        type: handle.kind,
        name: handle.name,
        path: state.filePath,
        knowledge: deterministicEnvelope(state.context, [evidenceId], 'framework-convention'),
      },
      state.filePath,
    );
  }
  return nodeId;
};

export interface UsageEdge {
  readonly handle: NamedHandle;
  readonly sourceId: string;
  readonly evidenceId: string;
}

export const emitUsageEdge = (state: JavaParseState, edge: UsageEdge): void => {
  const nodeId = emitHandleNode(state, edge.handle, edge.evidenceId);
  // §12.2.1: USES_UNKNOWN rather than a generic USES, so an unclassifiable binding would be named
  // honestly. Currently UNREACHABLE — the handle-kind union is exactly 'topic' | 'subscription' and
  // the map above covers both — so this is defensive, not a live bucket. Kept because a kind added to
  // that union must fail loudly as an unknown rather than silently borrow a relationship it is not.
  const type = EDGE_TYPE.get(edge.handle.kind) ?? 'USES_UNKNOWN';
  const edgeId = `pubsub:${type.toLowerCase()}:${edge.sourceId}->${nodeId}`;
  // Publishing to one topic twice in one method is one relationship, stated once.
  if (state.emittedIntegrationFacts.has(edgeId)) {
    return;
  }
  state.emittedIntegrationFacts.add(edgeId);
  state.builder.addEdge(
    {
      id: edgeId,
      type,
      sourceId: edge.sourceId,
      targetId: nodeId,
      knowledge: deterministicEnvelope(state.context, [edge.evidenceId], 'framework-convention'),
    },
    state.filePath,
  );
};

const record = (detection: Detection, node: Node, handle: NamedHandle, sourceId: string): void => {
  const evidenceId = callSiteEvidence(detection.state, node, handle.name);
  if (evidenceId !== undefined) {
    emitUsageEdge(detection.state, { handle, sourceId, evidenceId });
  }
};

const MAX_BODY_NODES = 5000;

/**
 * Pub/Sub topics, subscriptions and their publish/consume edges for one already-parsed method body,
 * constructor body or field initialiser. A file that imports no client library never reaches here,
 * so no existing fixture moves. Reading a tree is not running it (§35).
 */
export const collectPubSubBodyFacts = (
  detection: Detection,
  body: Node,
  sourceId: string,
): void => {
  const stack: Node[] = [body];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_BODY_NODES) {
    visited += 1;
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    const handle =
      node.type === 'method_invocation'
        ? (templateUsage(detection, node, sourceId) ?? builderUsage(detection, node))
        : node.type === 'object_creation_expression'
          ? adapterConstruction(detection.state, node)
          : undefined;
    if (handle !== undefined) {
      record(detection, node, handle, sourceId);
    }
    stack.push(...namedChildrenOf(node));
  }
};

export type { Detection };
