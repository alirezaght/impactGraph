import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * The outbox hop: producer → outbox record → relay → topic (item 5).
 *
 * A transactional outbox is the pattern that most reliably defeats call-graph analysis. The producer
 * writes a row and returns; the publish happens in another file, on another schedule, keyed only by
 * the event-type string. Nothing connects them syntactically, so a specification naming the producer
 * reached the producer and stopped.
 *
 * The join here is the EVENT TYPE STRING, which both sides state literally. That is a real shared
 * fact, and it is the only one — so when the producer computes the event type, no edge is emitted
 * (see the refusal below) rather than a guess.
 */

/** Call names that mean "write an event to the outbox" rather than "publish it now". */
const OUTBOX_CALLEES =
  /^(record|append|enqueue|save|insert|write|publish)?_?(outbox|domain)?_?(event|message|notification)$/i;

const OUTBOX_RECEIVERS = /outbox|event_?store|eventstore|event_?log/i;

const isOutboxWrite = (fact: CallFact): boolean =>
  OUTBOX_CALLEES.test(fact.calleeName) ||
  (fact.receiverName !== undefined && OUTBOX_RECEIVERS.test(fact.receiverName));

/**
 * An event type looks like `notification.nda_signature_request` or `NDA_SIGNATURE_REQUESTED`: a
 * dotted or screaming-snake identifier. Requiring that shape is what keeps ordinary string arguments
 * — a message body, a table name, a locale — from being promoted to event types.
 */
const EVENT_TYPE = /^([a-z][a-z0-9_]*(\.[a-z0-9_]+)+|[A-Z][A-Z0-9_]{4,})$/;

export const outboxRecordNodeId = (eventType: string): string => `outbox:${eventType}`;

/** Publisher-side calls: `pubsub.topic('x').publishMessage(...)` already produced a topic node. */
const topicNodes = (graph: CodeGraph): readonly { id: string; name: string }[] =>
  graph.nodes
    .filter((node) => node.type === 'topic' || node.type === 'pubsub-topic')
    .map((node) => ({ id: node.id, name: node.name }));

/**
 * The relay is the symbol that BOTH drains the outbox and publishes to a topic. Identifying it by
 * that conjunction rather than by name is what makes the link a fact: a file that only publishes is
 * a publisher, and a file that only drains is a reader; a file that does both is the relay.
 */
const DRAIN_NAME = /^(drain|read|poll|fetch|take)[A-Z_]?/;

const relayFilePaths = (graph: CodeGraph): ReadonlySet<string> => {
  const publishes = new Set<string>();
  for (const fact of graph.callFacts) {
    if (/^publish/i.test(fact.calleeName) || fact.receiverName === 'pubsub') {
      publishes.add(fact.filePath);
    }
  }
  // The drain half comes from SYMBOL REFERENCES, not call facts: `drainOutbox()` takes no string
  // argument, so it is not a call fact — but the language adapter did record that the relay calls
  // it, which is the same evidence in a different channel.
  const drains = new Set(
    (graph.symbolReferences ?? [])
      .filter((reference) => reference.kind === 'calls' && DRAIN_NAME.test(reference.targetName))
      .map((reference) => reference.filePath),
  );
  return new Set([...drains].filter((path) => publishes.has(path)));
};

interface OutboxLink {
  readonly eventType: string;
  readonly fact: CallFact;
}

const outboxWrites = (graph: CodeGraph): readonly OutboxLink[] => {
  const links: OutboxLink[] = [];
  for (const fact of graph.callFacts) {
    if (!isOutboxWrite(fact)) {
      continue;
    }
    const eventType = fact.stringArguments.find((argument) => EVENT_TYPE.test(argument));
    // REFUSAL: an outbox write whose event type is computed states no shared fact, so it produces no
    // record node. Reporting nothing is correct; guessing the type would fabricate the whole chain.
    if (eventType !== undefined) {
      links.push({ eventType, fact });
    }
  }
  return links;
};

export const linkOutbox = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): number => {
  const links = outboxWrites(graph);
  if (links.length === 0) {
    return 0;
  }
  const relays = relayFilePaths(graph);
  const topics = topicNodes(graph);
  const seen = new Set<string>();
  for (const { eventType, fact } of links) {
    const recordId = outboxRecordNodeId(eventType);
    if (!seen.has(recordId)) {
      seen.add(recordId);
      builder.addNode(
        {
          id: recordId,
          category: 'integration',
          type: 'outbox-record',
          name: eventType,
          knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
        },
        fact.filePath,
      );
    }
    const producerId = fact.enclosingSymbolNodeId ?? `file:${fact.filePath}`;
    builder.addEdge(
      {
        id: `edge:recorded-in:${producerId}->${recordId}`,
        type: 'RECORDED_IN',
        sourceId: producerId,
        targetId: recordId,
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
      },
      fact.filePath,
    );
    linkRelay({ builder, context, recordId, relays, topics, graph, evidenceId: fact.evidenceId });
  }
  return seen.size;
};

interface RelayInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly recordId: string;
  readonly relays: ReadonlySet<string>;
  readonly topics: readonly { id: string; name: string }[];
  readonly graph: CodeGraph;
  /** Evidence of the outbox write itself. The record node lives in the BUILDER, not in `graph`. */
  readonly evidenceId: string;
}

/**
 * outbox record → topic, via the relay.
 *
 * When exactly one relay file publishes to exactly one topic, the record reaches that topic and the
 * chain is complete. Ambiguity is not resolved by picking: with several relays or several topics the
 * boundary is emitted as UNRESOLVED, which says "the message leaves here and we cannot prove where it
 * lands" — the honest form of the answer (item 11).
 */
const linkRelay = ({
  builder,
  context,
  recordId,
  relays,
  topics,
  graph,
  evidenceId,
}: RelayInput): void => {
  const evidenceIds = [evidenceId];
  const reachable = topics.filter((topic) =>
    graph.callFacts.some(
      (fact) => relays.has(fact.filePath) && fact.stringArguments.includes(topic.name),
    ),
  );
  // Deduplicated BY NAME. The code-side `topic:notification-events` and the Terraform
  // `pubsub-topic` resource of the same name are one topic — they are already joined by DEPLOYED_AS
  // — so counting them as two candidates would refuse a chain that is in fact unambiguous.
  const names = new Set(reachable.map((topic) => topic.name));
  const target =
    names.size === 1
      ? (reachable.find((topic) => topic.id.startsWith('topic:')) ?? reachable[0])
      : undefined;
  if (target !== undefined) {
    builder.addEdge(
      {
        id: `edge:relays-to:${recordId}->${target.id}`,
        type: 'RELAYS_TO',
        sourceId: recordId,
        targetId: target.id,
        knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
      },
      'async-chain',
    );
    return;
  }
  const boundaryId = `unresolved:${recordId}`;
  builder.addNode(
    {
      id: boundaryId,
      category: 'integration',
      type: 'unresolved-external-boundary',
      name: `${recordId.slice('outbox:'.length)} → (unresolved relay target)`,
      knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
    },
    'async-chain',
  );
  builder.addEdge(
    {
      id: `edge:relays-to:${recordId}->${boundaryId}`,
      type: 'RELAYS_TO',
      sourceId: recordId,
      targetId: boundaryId,
      knowledge: deterministicEnvelope(context, evidenceIds, 'framework-convention'),
    },
    'async-chain',
  );
  builder.warn(
    'async-chain',
    `outbox record '${recordId}' has ${String(reachable.length)} candidate relay target(s) in this repository — the downstream topic is recorded as an unresolved boundary rather than guessed`,
  );
};
