import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { annotationsOf } from './java-annotations.js';
import { callSiteEvidence } from './java-context.js';
import { importsPubSubClient } from './java-pubsub-resources.js';
import { adapterConstruction, emitUsageEdge } from './java-pubsub.js';

import type { JavaParseState } from './java-context.js';
import type { NamedHandle } from './java-pubsub-resources.js';
import type { Node } from 'web-tree-sitter';

// Story 16.3, the Spring Integration half — `@ServiceActivator(inputChannel = "…")` (epic-16
// line 202). A file-level SECOND pass, because the handler method is routinely declared above the
// `@Bean` that wires the adapter, and neither can be read without the other.
//
// The honest problem: `@ServiceActivator(inputChannel = "pubsubInputChannel")` names a Spring
// Integration CHANNEL. A channel is not a subscription — it is a pipe that anything at all may
// feed. So the annotation on its own proves nothing about Pub/Sub, and emitting a subscription
// node from it would be a guess dressed up as a fact. What proves the link is the other end:
//
//   new PubSubInboundChannelAdapter(pubSubTemplate, "deal-events-worker")   ← names the subscription
//   adapter.setOutputChannel(inputChannel)                                  ← names the channel
//   @ServiceActivator(inputChannel = "pubsubInputChannel")                  ← consumes the channel
//
// Only when all three are in ONE compilation unit — which is how Spring Cloud GCP's own sample and
// virtually every `@Configuration` class writes it — is the chain provable here. Cross-file bean
// wiring needs a bean graph this adapter does not build, and a channel this file cannot bind is
// reported as a warning naming the channel (PRD §34), never linked to a plausible subscription.
//
// The subscription NODE does not depend on any of this: it is emitted by the adapter construction
// itself (see java-pubsub.ts), so cross-stack correlation with the Terraform resource works even
// when the handler stays unlinked. This pass only moves the SUBSCRIBES_TO edge onto the method
// that actually receives the messages.

const SERVICE_ACTIVATOR = 'ServiceActivator';
const INPUT_CHANNEL = 'inputChannel';
const QUALIFIER = 'Qualifier';
const SET_OUTPUT_CHANNEL = 'setOutputChannel';

const MAX_VISITED_NODES = 20_000;

const walk = (root: Node, visit: (node: Node) => void): void => {
  const stack: Node[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_VISITED_NODES) {
    visited += 1;
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visit(node);
    stack.push(...namedChildrenOf(node));
  }
};

const stringLiteralValue = (node: Node | undefined): string | undefined => {
  if (node?.type !== 'string_literal') {
    return undefined;
  }
  return namedChildrenOf(node).find((child) => child.type === 'string_fragment')?.text ?? '';
};

/** The value of one named annotation element: `@X(key = "value")`. */
const annotationElement = (annotation: Node, key: string): string | undefined => {
  for (const argument of namedChildrenOf(fieldNode(annotation, 'arguments') ?? annotation)) {
    if (argument.type === 'element_value_pair' && fieldNode(argument, 'key')?.text === key) {
      return stringLiteralValue(fieldNode(argument, 'value'));
    }
  }
  return undefined;
};

const annotationNamed = (declaration: Node, name: string): Node | undefined =>
  annotationsOf(declaration).find((annotation) => fieldNode(annotation, 'name')?.text === name);

const enclosing = (node: Node, types: ReadonlySet<string>): Node | undefined => {
  for (
    let current = node.parent ?? undefined;
    current !== undefined;
    current = current.parent ?? undefined
  ) {
    if (types.has(current.type)) {
      return current;
    }
  }
  return undefined;
};

const METHOD_TYPES = new Set(['method_declaration', 'constructor_declaration']);
const TYPE_TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
]);

/** `symbol:<file>#<Type>.<method>` — the id `java-declarations.ts` gave this method. */
const methodSymbolId = (state: JavaParseState, method: Node): string | undefined => {
  const methodName = fieldNode(method, 'name')?.text;
  const typeName = fieldNode(enclosing(method, TYPE_TYPES) ?? method, 'name')?.text;
  return methodName === undefined || typeName === undefined
    ? undefined
    : `symbol:${state.filePath}#${typeName}.${methodName}`;
};

/**
 * The channel name a `setOutputChannel(x)` argument states.
 *
 * Two shapes, both of which name a bean outright: a call to a `@Bean` method declared in this
 * class (`setOutputChannel(pubsubInputChannel())`), and a parameter carrying an explicit
 * `@Qualifier("…")`. An unqualified parameter is NOT read as a bean name even though Spring would
 * fall back to one — that fallback depends on the whole application context, and guessing it here
 * would silently attach a handler to the wrong subscription.
 */
const channelNameOf = (argument: Node, method: Node): string | undefined => {
  if (argument.type === 'method_invocation') {
    return fieldNode(argument, 'object') === undefined
      ? fieldNode(argument, 'name')?.text
      : undefined;
  }
  if (argument.type !== 'identifier') {
    return undefined;
  }
  const parameters = fieldNode(method, 'parameters');
  for (const parameter of parameters === undefined ? [] : namedChildrenOf(parameters)) {
    if (fieldNode(parameter, 'name')?.text === argument.text) {
      const qualifier = annotationNamed(parameter, QUALIFIER);
      return qualifier === undefined ? undefined : stringLiteralValue(firstArgument(qualifier));
    }
  }
  return undefined;
};

const firstArgument = (annotation: Node): Node | undefined =>
  namedChildrenOf(fieldNode(annotation, 'arguments') ?? annotation)[0];

interface Wiring {
  readonly subscriptions: NamedHandle[];
  readonly channels: string[];
}

const wiringOf = (state: JavaParseState, method: Node): Wiring => {
  const wiring: Wiring = { subscriptions: [], channels: [] };
  walk(method, (node) => {
    if (node.type === 'object_creation_expression') {
      const handle = adapterConstruction(state, node);
      if (handle?.kind === 'subscription') {
        wiring.subscriptions.push(handle);
      }
      return;
    }
    if (node.type !== 'method_invocation' || fieldNode(node, 'name')?.text !== SET_OUTPUT_CHANNEL) {
      return;
    }
    const argument = namedChildrenOf(fieldNode(node, 'arguments') ?? node)[0];
    const channel = argument === undefined ? undefined : channelNameOf(argument, method);
    if (channel !== undefined) {
      wiring.channels.push(channel);
    }
  });
  return wiring;
};

/**
 * Channel name → the subscription it carries, for the methods of this file.
 *
 * A method that wires exactly one adapter to exactly one channel is unambiguous. Anything else —
 * two adapters, two channels, a channel this pass cannot name — contributes nothing, because the
 * pairing would be a guess about which goes with which.
 */
const channelSubscriptions = (state: JavaParseState, root: Node): ReadonlyMap<string, string> => {
  const byChannel = new Map<string, string>();
  const ambiguous = new Set<string>();
  walk(root, (node) => {
    if (!METHOD_TYPES.has(node.type)) {
      return;
    }
    const { subscriptions, channels } = wiringOf(state, node);
    const only = subscriptions[0];
    const channel = channels[0];
    if (
      subscriptions.length !== 1 ||
      channels.length !== 1 ||
      only === undefined ||
      channel === undefined
    ) {
      return;
    }
    if (byChannel.get(channel) !== undefined && byChannel.get(channel) !== only.name) {
      ambiguous.add(channel);
    }
    byChannel.set(channel, only.name);
  });
  for (const channel of ambiguous) {
    byChannel.delete(channel);
    state.builder.warn(
      state.filePath,
      `channel '${channel}' is fed by more than one Pub/Sub subscription in this file — ` +
        '@ServiceActivator handlers on it were left unlinked rather than bound to a guess',
    );
  }
  return byChannel;
};

const linkHandler = (
  state: JavaParseState,
  method: Node,
  subscriptions: ReadonlyMap<string, string>,
): void => {
  const annotation = annotationNamed(method, SERVICE_ACTIVATOR);
  const channel =
    annotation === undefined ? undefined : annotationElement(annotation, INPUT_CHANNEL);
  if (annotation === undefined || channel === undefined) {
    return;
  }
  const subscription = subscriptions.get(channel);
  const sourceId = methodSymbolId(state, method);
  if (subscription === undefined || sourceId === undefined) {
    state.builder.warn(
      state.filePath,
      `@ServiceActivator consumes channel '${channel}', which no PubSubInboundChannelAdapter in ` +
        'this file binds to a subscription — the handler was left unlinked (PRD §34)',
    );
    return;
  }
  const evidenceId = callSiteEvidence(state, annotation, subscription);
  if (evidenceId !== undefined) {
    emitUsageEdge(state, {
      handle: { kind: 'subscription', name: subscription },
      sourceId,
      evidenceId,
    });
  }
};

/**
 * Link `@ServiceActivator` handlers to the Pub/Sub subscription their channel carries, when this
 * compilation unit states the whole chain. Runs after declarations, so the method symbol nodes the
 * edges start from already exist.
 */
export const collectServiceActivatorLinks = (state: JavaParseState, root: Node): void => {
  if (!importsPubSubClient(state)) {
    return;
  }
  const subscriptions = channelSubscriptions(state, root);
  walk(root, (node) => {
    if (node.type === 'method_declaration') {
      linkHandler(state, node, subscriptions);
    }
  });
};
