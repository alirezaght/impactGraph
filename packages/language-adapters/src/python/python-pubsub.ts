import { deterministicEnvelope } from '../fragment-builder.js';
import { addPubSubEnvFact } from '../pubsub-facts.js';
import { fieldNode, fieldNodes, namedChildrenOf } from '../tree-sitter/syntax.js';

import { callSiteEvidence } from './python-context.js';
import { envAccessName, importsOsModule } from './python-env-access.js';
import { ownerNodeId, walkPythonTree } from './python-owner.js';
import {
  attributeHandle,
  createAttributeHandles,
  isClassBodyAssignment,
  recordAttribute,
  selfAttributeName,
  selfAttributeTarget,
} from './python-pubsub-attributes.js';
import { dottedName, stringLiteralText } from './python-syntax.js';

import type { PythonParseState } from './python-context.js';
import type { AttributeHandles, PubSubHandle } from './python-pubsub-attributes.js';
import type { Node } from 'web-tree-sitter';

// Story 16.3 — `google.cloud.pubsub_v1` client usage (PRD §15.2, epic-16 line 142). The Python
// mirror of `typescript/parse-pubsub.ts`; the two agree on node ids (`topic:<name>`,
// `subscription:<name>`) and on provenance so the cross-stack adapter cannot tell them apart.
//
// PROVENANCE — `framework-convention` on every node and edge. The literal is parsed, but "the
// second string handed to `topic_path()` names a Pub/Sub topic" is knowledge about a library,
// not something the module states. Evidence is the parsed call site.
//
// `self.publisher.publish(…)` IS read (epic-16): instance attributes live in their own map, built
// by `python-pubsub-attributes.ts`, which also states why an attribute two classes disagree about
// resolves to nothing. Class-level attributes and attributes assigned outside `__init__` are the
// same shape and are read the same way — Python has no `private` and no declaration site.
//
// `topic_path(project, os.environ["TOPIC"])` names no topic HERE, and no node is emitted for it.
// The ENVIRONMENT VARIABLE NAME is a fact the module does state, so it travels on the
// `pubsub:env-name` channel (`../pubsub-facts.ts`) and is joined against Terraform's Cloud Run env
// bindings by `cross-stack/cloud-run-env.ts` — the only place that can see both halves. When the
// deployment configuration states nothing, the fact resolves to nothing.
//
// Deliberately NOT detected:
// * `publisher.topic_path(project, topic_variable)` — a GENUINELY non-literal name. The module does
//   not state the value anywhere (an f-string with a hole, a parameter, a computed string), so
//   there is no name this adapter may know and no variable name to record (§35). A permanent
//   limit, not a missing feature.

const CLIENT_CONSTRUCTORS = new Set(['PublisherClient', 'SubscriberClient']);

/**
 * Class-method factories that return a client, e.g.
 * `pubsub_v1.PublisherClient.from_service_account_file('key.json')`. The chain is read off the
 * callee text; nothing is imported and no credentials file is opened (PRD §35).
 */
const CLIENT_FACTORIES = new Set([
  'from_service_account_file',
  'from_service_account_json',
  'from_service_account_info',
]);

// These three are `Map`s, not object literals, deliberately: every key looked up in them comes
// from untrusted repository text, and an object literal answers `constructor` and `toString` from
// its prototype (PRD §42.5). A method called `toString` must be a miss, not a function.

/** `topic_path(project, name)` / `subscription_path(project, name)` → the handle they build. */
const PATH_METHODS = new Map<string, 'topic' | 'subscription'>([
  ['topic_path', 'topic'],
  ['subscription_path', 'subscription'],
]);

/** The client call that proves a relationship, and the handle kind its first argument must be. */
const USAGE_METHODS = new Map<string, 'topic' | 'subscription'>([
  ['publish', 'topic'],
  ['subscribe', 'subscription'],
]);

const EDGE_TYPE = new Map<string, string>([
  ['topic', 'PUBLISHES'],
  ['subscription', 'SUBSCRIBES_TO'],
]);

const CLIENT_MODULE = 'google.cloud.pubsub_v1';

interface Resolver {
  /** Module and local names. */
  readonly handles: Map<string, PubSubHandle>;
  /** `self.<name>` attributes, kept apart from names because they are different bindings. */
  readonly attributes: AttributeHandles;
  /** True when this module binds `os` — the gate on reading `os.environ[…]` at all. */
  readonly readsEnvironment: boolean;
}

const importsClientLibrary = (root: Node): boolean =>
  namedChildrenOf(root).some((statement) => {
    if (statement.type === 'import_statement') {
      return fieldNodes(statement, 'name').some((name) => name.text.startsWith(CLIENT_MODULE));
    }
    if (statement.type !== 'import_from_statement') {
      return false;
    }
    const module = fieldNode(statement, 'module_name')?.text ?? '';
    const names = fieldNodes(statement, 'name').map((name) => name.text);
    return (
      module.startsWith(CLIENT_MODULE) || (module === 'google.cloud' && names.includes('pubsub_v1'))
    );
  });

/** `topic_path(project, topic)` — the name is the SECOND positional argument, or the keyword. */
const NAME_ARGUMENT_POSITION = 1;

/**
 * The topic/subscription name a `*_path(project, name)` call literally states.
 *
 * Reading "the last string argument" would be wrong in the one case that matters:
 * `topic_path("deals", os.environ["TOPIC"])` states a project and an unknown topic, and taking
 * the last literal would publish the project name as a topic — a name the module never stated,
 * which would then correlate against a real Terraform resource and look convincing (§35).
 */
const nameArgumentNode = (call: Node, keyword: 'topic' | 'subscription'): Node | undefined => {
  const args = fieldNode(call, 'arguments');
  const children = args === undefined ? [] : namedChildrenOf(args);
  const keyworded = children.find(
    (child) => child.type === 'keyword_argument' && fieldNode(child, 'name')?.text === keyword,
  );
  if (keyworded !== undefined) {
    return fieldNode(keyworded, 'value');
  }
  return children.filter((child) => child.type !== 'keyword_argument')[NAME_ARGUMENT_POSITION];
};

const declaredPathName = (call: Node, keyword: 'topic' | 'subscription'): string | undefined => {
  const candidate = nameArgumentNode(call, keyword);
  return candidate === undefined ? undefined : stringLiteralText(candidate);
};

/**
 * What the name argument states: a literal, or the environment variable it is read from. Neither
 * is a guess — the module either wrote the string or wrote the variable's name.
 */
const pathResourceName = (
  resolver: Resolver,
  call: Node,
  keyword: 'topic' | 'subscription',
): Pick<PubSubHandle, 'name' | 'envName'> => {
  const stated = declaredPathName(call, keyword);
  if (stated !== undefined) {
    return { name: stated };
  }
  const candidate = resolver.readsEnvironment ? nameArgumentNode(call, keyword) : undefined;
  const envName = candidate === undefined ? undefined : envAccessName(candidate);
  return envName === undefined ? {} : { envName };
};

interface CalleeParts {
  readonly receiverName?: string;
  readonly method: string;
}

const calleeParts = (call: Node): CalleeParts | undefined => {
  const callee = fieldNode(call, 'function');
  const dotted = callee === undefined ? undefined : dottedName(callee);
  if (dotted === undefined) {
    return undefined; // a callee that is itself a call or a subscript — out of scope
  }
  const lastDot = dotted.lastIndexOf('.');
  return lastDot < 0
    ? { method: dotted }
    : { receiverName: dotted.slice(0, lastDot), method: dotted.slice(lastDot + 1) };
};

/**
 * What a receiver name evaluates to. `self.publisher` reads the ATTRIBUTE map; every other name
 * reads the module/local map. The two never fall back to each other.
 */
const receiverHandle = (resolver: Resolver, name: string | undefined): PubSubHandle | undefined => {
  if (name === undefined) {
    return undefined;
  }
  const attribute = selfAttributeName(name);
  return attribute === undefined
    ? resolver.handles.get(name)
    : attributeHandle(resolver.attributes, attribute);
};

/** `pubsub_v1.PublisherClient.from_service_account_file(…)` — the LAST segment names the class. */
const isClientClassPath = (receiverName: string | undefined): boolean => {
  if (receiverName === undefined) {
    return false;
  }
  return CLIENT_CONSTRUCTORS.has(receiverName.slice(receiverName.lastIndexOf('.') + 1));
};

/** What a Pub/Sub call evaluates to: a client, or a named topic/subscription path. */
const resolveCallHandle = (resolver: Resolver, call: Node): PubSubHandle | undefined => {
  const parts = calleeParts(call);
  if (parts === undefined) {
    return undefined;
  }
  if (CLIENT_CONSTRUCTORS.has(parts.method)) {
    return { kind: 'client' };
  }
  if (CLIENT_FACTORIES.has(parts.method) && isClientClassPath(parts.receiverName)) {
    return { kind: 'client' };
  }
  const kind = PATH_METHODS.get(parts.method);
  const receiver = receiverHandle(resolver, parts.receiverName);
  if (kind === undefined || receiver?.kind !== 'client') {
    return undefined;
  }
  const stated = pathResourceName(resolver, call, kind);
  return stated.name === undefined && stated.envName === undefined
    ? undefined
    : { kind, ...stated };
};

const resolveExpression = (resolver: Resolver, node: Node): PubSubHandle | undefined => {
  if (node.type === 'identifier') {
    return resolver.handles.get(node.text);
  }
  if (node.type === 'attribute') {
    const dotted = dottedName(node);
    return dotted === undefined ? undefined : receiverHandle(resolver, dotted);
  }
  return node.type === 'call' ? resolveCallHandle(resolver, node) : undefined;
};

const hasClientReceiver = (resolver: Resolver, parts: CalleeParts | undefined): boolean =>
  receiverHandle(resolver, parts?.receiverName)?.kind === 'client';

const firstArgumentHandle = (resolver: Resolver, call: Node): PubSubHandle | undefined => {
  const args = fieldNode(call, 'arguments');
  const first = args === undefined ? undefined : namedChildrenOf(args)[0];
  return first === undefined ? undefined : resolveExpression(resolver, first);
};

/** `publisher.publish(topic_path, …)` → the topic handle its first argument names. */
const usedHandle = (resolver: Resolver, call: Node): PubSubHandle | undefined => {
  const parts = calleeParts(call);
  const kind = parts === undefined ? undefined : USAGE_METHODS.get(parts.method);
  if (kind === undefined || !hasClientReceiver(resolver, parts)) {
    return undefined;
  }
  const handle = firstArgumentHandle(resolver, call);
  const states = handle?.name !== undefined || handle?.envName !== undefined;
  return handle?.kind === kind && states ? handle : undefined;
};

interface Emitter {
  readonly state: PythonParseState;
  readonly emitted: Set<string>;
}

const emitHandleNode = (emitter: Emitter, handle: PubSubHandle, evidenceId: string): string => {
  const { state } = emitter;
  const nodeId = `${handle.kind}:${handle.name ?? ''}`;
  if (!emitter.emitted.has(nodeId)) {
    emitter.emitted.add(nodeId);
    state.builder.addNode(
      {
        id: nodeId,
        category: 'integration',
        type: handle.kind,
        name: handle.name ?? '',
        path: state.filePath,
        knowledge: deterministicEnvelope(state.context, [evidenceId], 'framework-convention'),
      },
      state.filePath,
    );
  }
  return nodeId;
};

/**
 * Record the environment variable a resource name is read from — a fact, not a node. Whether a
 * topic name follows depends on a Terraform configuration this adapter cannot see.
 */
const recordEnvName = (state: PythonParseState, handle: PubSubHandle, call: Node): void => {
  const envName = handle.envName;
  const evidenceId = envName === undefined ? undefined : callSiteEvidence(state, call, envName);
  if (envName === undefined || evidenceId === undefined) {
    return;
  }
  addPubSubEnvFact(state.builder, {
    filePath: state.filePath,
    kind: handle.kind === 'subscription' ? 'subscription' : 'topic',
    reference: envName,
    sourceId: ownerNodeId(state, call),
    evidenceId,
  });
};

const emitUsageEdge = (emitter: Emitter, handle: PubSubHandle, call: Node): void => {
  const { state } = emitter;
  const evidenceId = callSiteEvidence(state, call, handle.name ?? '');
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = emitHandleNode(emitter, handle, evidenceId);
  const sourceId = ownerNodeId(state, call);
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

/**
 * Bind one assignment's target, in the map that target actually belongs to.
 *
 * A class-level attribute is recorded in BOTH: `class C: publisher = PublisherClient()` is reachable
 * as `C.publisher` from module scope and as `self.publisher` from every method, and the module has
 * stated one handle for both.
 */
const bindTarget = (
  resolver: Resolver,
  assignment: Node,
  target: Node,
  handle: PubSubHandle,
): void => {
  const attribute = selfAttributeTarget(target);
  if (attribute !== undefined) {
    recordAttribute(resolver.attributes, attribute, handle);
    return;
  }
  if (target.type !== 'identifier') {
    return;
  }
  resolver.handles.set(target.text, handle);
  if (isClassBodyAssignment(assignment)) {
    recordAttribute(resolver.attributes, target.text, handle);
  }
};

const collectHandles = (resolver: Resolver, root: Node): void => {
  walkPythonTree(root, (node) => {
    if (node.type !== 'assignment') {
      return;
    }
    const target = fieldNode(node, 'left');
    const value = fieldNode(node, 'right');
    const handle = value === undefined ? undefined : resolveExpression(resolver, value);
    if (target !== undefined && handle !== undefined) {
      bindTarget(resolver, node, target, handle);
    }
  });
};

/**
 * Pub/Sub topics, subscriptions and their publish/consume edges for one already-parsed module.
 * A module that does not import the client library is untouched, so no existing fixture moves.
 */
export const collectPubSubFacts = (state: PythonParseState, root: Node): void => {
  if (!importsClientLibrary(root)) {
    return;
  }
  const resolver: Resolver = {
    handles: new Map<string, PubSubHandle>(),
    attributes: createAttributeHandles(),
    readsEnvironment: importsOsModule(root),
  };
  collectHandles(resolver, root);
  const emitter: Emitter = { state, emitted: new Set<string>() };
  walkPythonTree(root, (node) => {
    if (node.type !== 'call') {
      return;
    }
    const handle = usedHandle(resolver, node);
    if (handle?.name !== undefined) {
      emitUsageEdge(emitter, handle, node);
    } else if (handle !== undefined) {
      recordEnvName(state, handle, node);
    }
  });
};
