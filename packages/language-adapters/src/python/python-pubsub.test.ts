import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// Story 16.3 — `google.cloud.pubsub_v1` client detection (PRD §15.2, epic-16 line 142). Same
// negative-space discipline as the TypeScript suite: the topics this must REFUSE to emit are what
// keeps the Terraform correlation honest.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-pubsub-py',
  analysisRunId: 'run-pubsub-py',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (content: string, relativePath = 'app/events.py'): Promise<GraphFragment> =>
  createPythonAdapter().indexFiles([{ relativePath, content }], CONTEXT);

const integration = (fragment: GraphFragment): string[] =>
  fragment.nodes
    .filter((node) => node.category === 'integration')
    .map((node) => `${node.type}:${node.name}`)
    .sort();

const pubsubEdges = (fragment: GraphFragment): string[] =>
  fragment.edges
    .filter((edge) => edge.type === 'PUBLISHES' || edge.type === 'SUBSCRIBES_TO')
    .map((edge) => `${edge.type}|${edge.sourceId}->${edge.targetId}`)
    .sort();

describe('Python Pub/Sub client detection (Story 16.3)', () => {
  it('detects a publisher and a subscriber built from module-level clients', async () => {
    const fragment = await index(`from google.cloud import pubsub_v1

PROJECT = "deals"
publisher = pubsub_v1.PublisherClient()
subscriber = pubsub_v1.SubscriberClient()
topic_path = publisher.topic_path(PROJECT, "deal-events")
subscription_path = subscriber.subscription_path(PROJECT, "deal-events-worker")


def publish_deal(payload: bytes) -> None:
    publisher.publish(topic_path, payload)


def consume() -> None:
    subscriber.subscribe(subscription_path, callback=handle)
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#publish_deal->topic:deal-events',
      'SUBSCRIBES_TO|symbol:app/events.py#consume->subscription:deal-events-worker',
    ]);
  });

  it('resolves a client and path built inside the function, and attributes a method correctly', async () => {
    const fragment = await index(`from google.cloud.pubsub_v1 import PublisherClient


class DealPublisher:
    def send(self, payload: bytes) -> None:
        client = PublisherClient()
        client.publish(client.topic_path("deals", "deal-events"), payload)
`);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#DealPublisher.send->topic:deal-events',
    ]);
  });

  it('attributes a nested-function publish to the enclosing declared symbol, never a dangling id', async () => {
    const fragment = await index(`from google.cloud import pubsub_v1

publisher = pubsub_v1.PublisherClient()
topic_path = publisher.topic_path("deals", "deal-events")


def outer() -> None:
    def inner() -> None:
        publisher.publish(topic_path, b"x")

    inner()
`);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#outer->topic:deal-events',
    ]);
    const declared = new Set(fragment.nodes.map((node) => node.id));
    for (const edge of fragment.edges) {
      expect(declared.has(edge.sourceId), `dangling source ${edge.sourceId}`).toBe(true);
    }
  });

  it('carries framework-convention provenance and call-site evidence', async () => {
    const fragment = await index(`from google.cloud import pubsub_v1

publisher = pubsub_v1.PublisherClient()
path = publisher.topic_path("deals", "deal-events")
publisher.publish(path, b"x")
`);
    const topic = fragment.nodes.find((node) => node.id === 'topic:deal-events');
    const edge = fragment.edges.find((candidate) => candidate.type === 'PUBLISHES');
    expect(topic?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.sourceId).toBe('file:app/events.py');
    const evidenceIds = new Set(fragment.evidence.map((record) => record.id));
    expect(edge?.knowledge.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
  });

  it('never matches a look-alike module or an unrelated publish', async () => {
    const fragment = await index(`from internal.messaging import pubsub_v1

publisher = pubsub_v1.PublisherClient()
path = publisher.topic_path("deals", "deal-events")
publisher.publish(path, b"x")
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('never invents a name the module does not state', async () => {
    const fragment = await index(`from google.cloud import pubsub_v1
import os

publisher = pubsub_v1.PublisherClient()
path = publisher.topic_path("deals", os.environ["TOPIC"])
publisher.publish(path, b"x")
publisher.publish(unknown_path, b"x")
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  // PRD §42.5 — the topic name and the method name are untrusted repository text.
  it('survives hostile names and prototype keys without crashing or losing the rest of the module', async () => {
    const fragment = await index(`from google.cloud import pubsub_v1

publisher = pubsub_v1.PublisherClient()
traversal = publisher.topic_path("p", "../../../../etc/passwd")
proto = publisher.topic_path("p", "__proto__")
publisher.publish(traversal, b"x")
publisher.publish(proto, b"x")
publisher.toString(traversal, b"x")
publisher.constructor(traversal, b"x")


def control() -> bool:
    return True
`);
    expect(fragment.nodes.some((node) => node.id === 'symbol:app/events.py#control')).toBe(true);
    for (const node of fragment.nodes.filter((candidate) => candidate.category === 'integration')) {
      expect(node.type).toBe('topic');
    }
    // `toString` and `constructor` are prototype keys, not Pub/Sub methods: exactly two edges.
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|file:app/events.py->topic:../../../../etc/passwd',
      'PUBLISHES|file:app/events.py->topic:__proto__',
    ]);
  });

  it('leaves a module that never imports the client library completely untouched', async () => {
    const fragment = await index(`class Publisher:
    def publish(self, topic_path, payload):
        return None


publisher = Publisher()
publisher.publish("deal-events", b"x")
`);
    expect(integration(fragment)).toEqual([]);
  });
});

// Instance-attribute binding (epic-16, formerly a recorded gap): a Python client is usually held on
// `self`, not in a module-level name. Attributes live in their own map, and an attribute two
// classes disagree about resolves to nothing rather than to whichever was seen last.
describe('Python Pub/Sub instance-attribute binding', () => {
  const IMPORT = 'from google.cloud import pubsub_v1\n';

  it('resolves a client and a path held on self, assigned in __init__', async () => {
    const fragment = await index(`${IMPORT}

class DealPublisher:
    def __init__(self) -> None:
        self.publisher = pubsub_v1.PublisherClient()
        self.deal_events = self.publisher.topic_path("deals", "deal-events")

    def send(self, payload: bytes) -> None:
        self.publisher.publish(self.deal_events, payload)
`);
    expect(integration(fragment)).toEqual(['topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#DealPublisher.send->topic:deal-events',
    ]);
    // Same provenance, snapshot and real call-site range as every other Pub/Sub fact.
    const edge = fragment.edges.find((candidate) => candidate.type === 'PUBLISHES');
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.knowledge.repositorySnapshotId).toBe('snap-pubsub-py');
    const cited = fragment.evidence.filter((record) =>
      (edge?.knowledge.evidenceIds ?? []).includes(record.id),
    );
    const positions = cited.map((record) =>
      record.source.kind === 'file' && record.source.range !== undefined
        ? `${String(record.source.range.startLine)}:${String(record.source.range.startColumn)}`
        : 'NO-RANGE',
    );
    // A real range over `self.publisher.publish(self.deal_events, payload)`. Deduplicated because
    // the call-site evidence id is shared with the plain CallFact this same line already produced.
    expect([...new Set(positions)]).toEqual(['10:9']);
  });

  it('reads a CLASS-level attribute, reachable as self.<name> from every method', async () => {
    const fragment = await index(`${IMPORT}

class DealConsumer:
    subscriber = pubsub_v1.SubscriberClient()

    def consume(self) -> None:
        self.subscriber.subscribe(
            self.subscriber.subscription_path("deals", "deal-events-worker"), callback=None
        )
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker']);
    expect(pubsubEdges(fragment)).toEqual([
      'SUBSCRIBES_TO|symbol:app/events.py#DealConsumer.consume->subscription:deal-events-worker',
    ]);
  });

  it('reads an attribute assigned outside __init__ — Python has no declaration site', async () => {
    const fragment = await index(`${IMPORT}

class DealPublisher:
    def connect(self) -> None:
        self.publisher = pubsub_v1.PublisherClient.from_service_account_file("key.json")

    def send(self, payload: bytes) -> None:
        self.publisher.publish(self.publisher.topic_path("deals", "deal-events"), payload)
`);
    expect(integration(fragment)).toEqual(['topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#DealPublisher.send->topic:deal-events',
    ]);
  });

  it('keeps a module-level name and a same-named attribute distinct', async () => {
    const fragment = await index(`${IMPORT}

publisher = pubsub_v1.PublisherClient()
path = publisher.topic_path("deals", "deal-events")


class Other:
    def __init__(self) -> None:
        self.publisher = InternalBus()

    def send(self, payload: bytes) -> None:
        self.publisher.publish(path, payload)
`);
    // `self.publisher` is not the module's client, so nothing about this class is a publication.
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('two classes disagreeing about the same attribute resolve to NOTHING, never a guess', async () => {
    const fragment = await index(`${IMPORT}

publisher = pubsub_v1.PublisherClient()


class A:
    def __init__(self) -> None:
        self.path = publisher.topic_path("deals", "topic-a")

    def send(self, payload: bytes) -> None:
        publisher.publish(self.path, payload)


class B:
    def __init__(self) -> None:
        self.path = publisher.topic_path("deals", "topic-b")

    def send(self, payload: bytes) -> None:
        publisher.publish(self.path, payload)
`);
    // The file-scoped attribute map cannot tell which class a `self.path` meant, and Python offers
    // no declaration site that would settle it, so it emits neither topic.
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('never invents a name for a non-literal attribute path, however it is reached', async () => {
    const fragment = await index(`${IMPORT}
import os

env = os.environ["ENV"]


class DealPublisher:
    def __init__(self) -> None:
        self.publisher = pubsub_v1.PublisherClient()
        self.path = self.publisher.topic_path("deals", f"deal-{env}")

    def send(self, payload: bytes) -> None:
        self.publisher.publish(self.path, payload)
        self.publisher.publish(self.missing, payload)
        self.a.b.publish(self.path, payload)
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  // PRD §42.5 — attribute names reach a new map, and every key comes from untrusted text.
  it('treats hostile attribute names as misses, never as prototype members', async () => {
    const fragment = await index(`${IMPORT}

class DealPublisher:
    def __init__(self) -> None:
        self.constructor = pubsub_v1.PublisherClient()
        self.__proto__ = self.constructor.topic_path("deals", "deal-events")

    def send(self, payload: bytes) -> None:
        self.constructor.publish(self.__proto__, payload)
        self.toString.publish(self.__proto__, payload)


def control() -> bool:
    return True
`);
    // The two real bindings resolve; `self.toString` was never assigned and must be a miss.
    expect(integration(fragment)).toEqual(['topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:app/events.py#DealPublisher.send->topic:deal-events',
    ]);
    expect(fragment.nodes.some((node) => node.id === 'symbol:app/events.py#control')).toBe(true);
  });
});
