import ts from 'typescript';

import { deterministicEnvelope } from '../fragment-builder.js';
import { addPubSubEnvFact } from '../pubsub-facts.js';

import { envAccessName } from './env-access.js';
import { evidenceIdFor, rangeOf } from './parse-context.js';
import { ownerNodeId } from './parse-owner.js';
import { bindsNothing, clientBindings, isClientConstruction } from './pubsub-bindings.js';
import { stringConstants } from './pubsub-constants.js';

import type { ParseState } from './parse-context.js';
import type { ClientBindings } from './pubsub-bindings.js';
import type { StringConstants } from './pubsub-constants.js';

// Story 16.3 — `@google-cloud/pubsub` client usage (PRD §15.2, epic-16 line 142).
//
// Why this lives in the language adapter rather than a framework adapter: the facts it needs are
// chained member calls inside function bodies (`pubsub.topic('x').publishMessage(…)`), and the
// `CallFact` channel deliberately carries only module-level, single-receiver calls. Widening that
// channel would change what every other call-convention adapter sees; deriving the facts during
// the parse this adapter is already doing changes nothing for anybody else. It is the same shape
// as the `api-endpoint` directory convention in `parse-source.ts`: a convention-derived fact,
// emitted from the one pass that already has the tree. Nothing is re-parsed and nothing is run.
//
// PROVENANCE — `framework-convention`, never `static-analysis`, for both the nodes and the edges.
// The string literal is genuinely parsed, but "a string handed to `.topic()` names a Pub/Sub
// topic, and `.publishMessage()` on it is a publication" is knowledge about a library, not
// something the source states. §12.3's deterministic `framework-convention` category is exactly
// that case. Evidence is the parsed call site, so a reviewer can open the line and check.
//
// Which local names count as the client library is decided in `pubsub-bindings.ts`, which reads
// ES imports AND CommonJS `require` (epic-16: `const { PubSub } = require('@google-cloud/pubsub')`
// binds exactly the handle `import { PubSub }` binds). Everything below is module-system-agnostic.
//
// A name held in a module constant IS read (`pubsub-constants.ts`): `const TOPIC = 'deal-events'`
// states the value on the line above the call, so propagating it reports what the file says rather
// than inventing anything. Only single-assignment `const` string literals qualify; see that module.
//
// `process.env.TOPIC` names no topic HERE, and this adapter still emits no node for it. What it
// does emit is the fact the file genuinely states: the ENVIRONMENT VARIABLE NAME, on the
// `pubsub:env-name` channel (`../pubsub-facts.ts`). A Cloud Run service whose Terraform sets that
// same variable to a `google_pubsub_topic` reference states the other half, and
// `cross-stack/cloud-run-env.ts` is the only place that can see both. If the deployment
// configuration says nothing, the fact resolves to nothing and no node is ever created.
//
// Deliberately NOT detected, rather than guessed:
// * A GENUINELY non-literal name — a function parameter, an imported binding, a template literal
//   with a hole, any runtime-computed string. The repository does not state the value ANYWHERE, so
//   there is no name this adapter is allowed to know and no env var name to record either (§35).
//   This is a permanent limit, not a missing feature: emitting a node for it would invent a fact
//   that then correlates against real infrastructure and looks convincing.

/** The publish surface of a `Topic` handle across the library's versions. */
const PUBLISH_METHODS = new Set(['publish', 'publishMessage', 'publishJSON']);

const MESSAGE_EVENT = 'message';

interface Handle {
  readonly kind: 'client' | 'topic' | 'subscription';
  /** The declared name, for a topic or subscription handle built from a string literal. */
  readonly name?: string;
  /** The environment variable the name is read from, when the file states one instead. */
  readonly envName?: string;
}

/** A field whose handle two classes in one file disagree about — resolvable by nobody. */
const AMBIGUOUS = Symbol('ambiguous-field');

interface Resolver {
  readonly bindings: ClientBindings;
  readonly handles: Map<string, Handle>;
  /** Names this file binds to a stated string — the only identifiers that may name a resource. */
  readonly constants: StringConstants;
  /**
   * `this.<name>` handles, kept apart from locals because they are different bindings: a local
   * `pubsub` and a field `this.pubsub` may hold different things, and merging them would let one
   * shadow the other. Fields are class-scoped while this map is file-scoped, so when two classes
   * declare the same field name with different handles the entry becomes AMBIGUOUS and resolves
   * to nothing — the adapter does not guess which class a `this.` reference meant.
   */
  readonly fields: Map<string, Handle | typeof AMBIGUOUS>;
}

/** `this.<name>` — the only property access this adapter resolves. */
const thisFieldName = (expression: ts.Expression): string | undefined =>
  ts.isPropertyAccessExpression(expression) &&
  expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ? expression.name.text
    : undefined;

const sameHandle = (left: Handle, right: Handle): boolean =>
  left.kind === right.kind && left.name === right.name && left.envName === right.envName;

/** Record a field handle, collapsing to AMBIGUOUS when a second class disagrees. */
const recordField = (resolver: Resolver, name: string, handle: Handle): void => {
  const existing = resolver.fields.get(name);
  if (existing === undefined) {
    resolver.fields.set(name, handle);
    return;
  }
  if (existing === AMBIGUOUS || !sameHandle(existing, handle)) {
    resolver.fields.set(name, AMBIGUOUS);
  }
};

/** The string an argument states: written inline, or held in a `const` this file declares. */
const declaredString = (resolver: Resolver, call: ts.CallExpression): string | undefined => {
  const first = call.arguments[0];
  if (first === undefined) {
    return undefined;
  }
  if (ts.isStringLiteral(first)) {
    return first.text;
  }
  return ts.isIdentifier(first) ? resolver.constants.get(first.text) : undefined;
};

/** What the resource argument of `client.topic(x)` states: a name, an env var name, or nothing. */
type ResourceArgument = Pick<Handle, 'name' | 'envName'>;

const NOTHING_STATED: ResourceArgument = {};

const statesNothing = (argument: ResourceArgument): boolean =>
  argument.name === undefined && argument.envName === undefined;

/** A stated string, a `const` this file binds to one, or the environment variable it reads. */
const resourceArgument = (resolver: Resolver, call: ts.CallExpression): ResourceArgument => {
  const first = call.arguments[0];
  if (first === undefined) {
    return NOTHING_STATED;
  }
  const stated = declaredString(resolver, call);
  if (stated !== undefined) {
    return { name: stated };
  }
  const envName = envAccessName(first);
  return envName === undefined ? NOTHING_STATED : { envName };
};

/** `client.topic('x')` → a topic handle; `client.subscription('y')` / `topic.subscription('y')`. */
const handleFromMethod = (
  method: string,
  receiver: Handle | undefined,
  argument: ResourceArgument,
): Handle | undefined => {
  if (statesNothing(argument) || receiver === undefined) {
    return undefined;
  }
  if (method === 'topic' && receiver.kind === 'client') {
    return { kind: 'topic', ...argument };
  }
  if (method === 'subscription' && receiver.kind !== 'subscription') {
    return { kind: 'subscription', ...argument };
  }
  return undefined;
};

/** `this.<name>` → the field's handle, or undefined when unknown or ambiguous across classes. */
const resolveThisField = (resolver: Resolver, expression: ts.Expression): Handle | undefined => {
  const field = thisFieldName(expression);
  const held = field === undefined ? undefined : resolver.fields.get(field);
  return held === undefined || held === AMBIGUOUS ? undefined : held;
};

/** What a Pub/Sub expression evaluates to, following chains and variables. Never guesses. */
const resolveHandle = (resolver: Resolver, expression: ts.Expression): Handle | undefined => {
  if (ts.isIdentifier(expression)) {
    return resolver.handles.get(expression.text);
  }
  const fromField = resolveThisField(resolver, expression);
  if (fromField !== undefined) {
    return fromField;
  }
  if (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return resolveHandle(resolver, expression.expression);
  }
  if (ts.isNewExpression(expression)) {
    return isClientConstruction(resolver.bindings, expression.expression)
      ? { kind: 'client' }
      : undefined;
  }
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return undefined;
  }
  const callee = expression.expression;
  return handleFromMethod(
    callee.name.text,
    resolveHandle(resolver, callee.expression),
    resourceArgument(resolver, expression),
  );
};

/** A `Map`, not an object literal: keys derived from untrusted text must miss on `constructor`. */
const EDGE_TYPE = new Map<string, string>([
  ['topic', 'PUBLISHES'],
  ['subscription', 'SUBSCRIBES_TO'],
]);

/** A handle whose name the source stated — the only kind that may become a node. */
type NamedHandle = Handle & { readonly name: string };

/** A handle whose name is read from an environment variable — a fact, never a node. */
type EnvHandle = Handle & { readonly envName: string };

const isNamed = (handle: Handle): handle is NamedHandle => handle.name !== undefined;

interface Emitter {
  readonly state: ParseState;
  readonly emitted: Set<string>;
}

const evidenceFor = (
  state: ParseState,
  call: ts.CallExpression,
  name: string,
): string | undefined => {
  const range = rangeOf(state.source, call);
  return state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'call-site', range),
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName: name },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

/** Emit the `topic`/`subscription` node for a resolved handle. Idempotent within one file. */
const emitHandleNode = (emitter: Emitter, handle: NamedHandle, evidenceId: string): string => {
  const { state } = emitter;
  const nodeId = `${handle.kind}:${handle.name}`;
  if (!emitter.emitted.has(nodeId)) {
    emitter.emitted.add(nodeId);
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

/**
 * Record the environment variable a resource name is read from. No node and no edge: this file
 * states a variable name, and whether any topic name follows from it depends on a Terraform
 * configuration this adapter cannot see (`cross-stack/cloud-run-env.ts`).
 */
const recordEnvName = (state: ParseState, handle: EnvHandle, call: ts.CallExpression): void => {
  const evidenceId = evidenceFor(state, call, handle.envName);
  if (evidenceId === undefined) {
    return;
  }
  addPubSubEnvFact(state.builder, {
    filePath: state.filePath,
    kind: handle.kind === 'subscription' ? 'subscription' : 'topic',
    reference: handle.envName,
    sourceId: ownerNodeId(state.filePath, call),
    evidenceId,
  });
};

const emitUsageEdge = (emitter: Emitter, handle: NamedHandle, call: ts.CallExpression): void => {
  const { state } = emitter;
  const evidenceId = evidenceFor(state, call, handle.name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = emitHandleNode(emitter, handle, evidenceId);
  const sourceId = ownerNodeId(state.filePath, call);
  const type = EDGE_TYPE.get(handle.kind) ?? 'USES';
  state.builder.addEdge(
    {
      id: `pubsub:${type.toLowerCase()}:${sourceId}->${nodeId}`,
      type,
      sourceId,
      targetId: nodeId,
      knowledge: deterministicEnvelope(state.context, [evidenceId], 'framework-convention'),
    },
    state.filePath,
  );
};

/** Does this call publish to, or consume from, the handle its receiver evaluates to? */
const usedHandle = (resolver: Resolver, call: ts.CallExpression): Handle | undefined => {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const method = call.expression.name.text;
  const receiver = resolveHandle(resolver, call.expression.expression);
  if (receiver === undefined || (receiver.name === undefined && receiver.envName === undefined)) {
    return undefined;
  }
  if (receiver.kind === 'topic' && PUBLISH_METHODS.has(method)) {
    return receiver;
  }
  const listening = method === 'on' && declaredString(resolver, call) === MESSAGE_EVENT;
  return receiver.kind === 'subscription' && listening ? receiver : undefined;
};

/** `private readonly pubsub = new PubSub()` and `this.pubsub = new PubSub()` in a constructor. */
const collectFieldHandle = (resolver: Resolver, node: ts.Node): void => {
  if (
    ts.isPropertyDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined
  ) {
    const handle = resolveHandle(resolver, node.initializer);
    if (handle !== undefined) {
      recordField(resolver, node.name.text, handle);
    }
    return;
  }
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return;
  }
  const assigned = thisFieldName(node.left);
  const handle = assigned === undefined ? undefined : resolveHandle(resolver, node.right);
  if (assigned !== undefined && handle !== undefined) {
    recordField(resolver, assigned, handle);
  }
};

const collectHandles = (resolver: Resolver, source: ts.SourceFile): void => {
  const visit = (node: ts.Node): void => {
    const declared = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name);
    if (declared && node.initializer !== undefined) {
      const handle = resolveHandle(resolver, node.initializer);
      if (handle !== undefined) {
        resolver.handles.set(node.name.getText(source), handle);
      }
    }
    collectFieldHandle(resolver, node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
};

/**
 * Pub/Sub topics, subscriptions and their publish/consume edges for one already-parsed file.
 * A file that does not import the client library is untouched, so no existing fixture moves.
 */
export const collectPubSubFacts = (state: ParseState): void => {
  const bindings = clientBindings(state.source);
  if (bindsNothing(bindings)) {
    return;
  }
  const resolver: Resolver = {
    bindings,
    handles: new Map<string, Handle>(),
    constants: stringConstants(state.source),
    fields: new Map<string, Handle | typeof AMBIGUOUS>(),
  };
  collectHandles(resolver, state.source);
  const emitter: Emitter = { state, emitted: new Set<string>() };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const handle = usedHandle(resolver, node);
      if (handle !== undefined && isNamed(handle)) {
        emitUsageEdge(emitter, handle, node);
      } else if (handle?.envName !== undefined) {
        recordEnvName(state, { ...handle, envName: handle.envName }, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(state.source, visit);
};
