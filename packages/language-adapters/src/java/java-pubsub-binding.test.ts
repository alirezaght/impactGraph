import { describe, expect, it } from 'vitest';

import { createJavaAdapter } from './java-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// epic-16 — the three Java Pub/Sub shapes that were recorded gaps: field initialisers, a template
// reached through a getter, and the `Publisher.newBuilder("projects/p/topics/t")` resource-path
// string form. Split from `java-pubsub.test.ts`, which is at its effective-LOC limit.
//
// The refusals matter more than the positives, as always here: a topic name this adapter invents
// would correlate against a real Terraform resource and look entirely convincing.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-pubsub-java-binding',
  analysisRunId: 'run-pubsub-java-binding',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const FILE = 'src/main/java/com/example/DealEvents.java';

const index = (content: string): Promise<GraphFragment> =>
  createJavaAdapter().indexFiles([{ relativePath: FILE, content }], CONTEXT);

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

const warnings = (fragment: GraphFragment): string =>
  fragment.warnings.map((warning) => warning.message).join('\n');

/** `<startLine>:<startColumn>-<endLine>` for every evidence record an id list cites. */
const citedRanges = (fragment: GraphFragment, evidenceIds: readonly string[]): string[] =>
  fragment.evidence
    .filter((record) => evidenceIds.includes(record.id))
    .map((record) => {
      const range = record.source.kind === 'file' ? record.source.range : undefined;
      return range === undefined
        ? 'NO-RANGE'
        : `${String(range.startLine)}:${String(range.startColumn)}-${String(range.endLine)}:${String(range.endColumn)}`;
    });

const NATIVE_IMPORTS = `import com.google.cloud.pubsub.v1.Publisher;
import com.google.cloud.pubsub.v1.Subscriber;
import com.google.pubsub.v1.ProjectSubscriptionName;
import com.google.pubsub.v1.TopicName;`;

describe('Java Pub/Sub field initialisers (epic-16)', () => {
  it('reads a Publisher built in a field initialiser, attributed to the field itself', async () => {
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  private final Publisher publisher =
      Publisher.newBuilder(TopicName.of("deals", "deal-events")).build();
}
`);
    expect(integration(fragment)).toEqual(['topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.publisher->topic:deal-events`,
    ]);
  });

  it('resolves a resource-name FIELD from an initialiser declared above it', async () => {
    // The class scope is read before any member, so declaration order does not decide the answer.
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  private final Subscriber subscriber = Subscriber.newBuilder(SUBSCRIPTION, null).build();
  private static final ProjectSubscriptionName SUBSCRIPTION =
      ProjectSubscriptionName.of("deals", "deal-events-worker");
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker']);
    expect(pubsubEdges(fragment)).toEqual([
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.subscriber->subscription:deal-events-worker`,
    ]);
  });

  it('carries framework-convention provenance and evidence on a field-initialiser fact', async () => {
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  private final Publisher publisher =
      Publisher.newBuilder(TopicName.of("deals", "deal-events")).build();
}
`);
    const topic = fragment.nodes.find((node) => node.id === 'topic:deal-events');
    const edge = fragment.edges.find((candidate) => candidate.type === 'PUBLISHES');
    expect(topic?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect(topic?.knowledge.repositorySnapshotId).toBe('snap-pubsub-java-binding');
    const evidenceIds = new Set(fragment.evidence.map((record) => record.id));
    expect(edge?.knowledge.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    // A real range over the `Publisher.newBuilder(TopicName.of(…))` call itself — the reviewer
    // opens exactly the initialiser the fact was read from, not the field or the class.
    expect(citedRanges(fragment, edge?.knowledge.evidenceIds ?? [])).toEqual(['10:7-10:65']);
  });

  it('keeps two classes with the same field name apart, each on its own topic', async () => {
    // Java states the class boundary outright, so the scope is built per class body and the
    // file-scoped AMBIGUOUS sentinel the TypeScript and Python detectors need is unnecessary
    // here: neither class can reach the other's field, so neither has to be refused.
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

class A {
  private static final TopicName TOPIC = TopicName.of("deals", "topic-a");
  private final Publisher publisher = Publisher.newBuilder(TOPIC).build();
}

class B {
  private static final TopicName TOPIC = TopicName.of("deals", "topic-b");
  private final Publisher publisher = Publisher.newBuilder(TOPIC).build();
}
`);
    expect(integration(fragment)).toEqual(['topic:topic-a', 'topic:topic-b']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#A.publisher->topic:topic-a`,
      `PUBLISHES|symbol:${FILE}#B.publisher->topic:topic-b`,
    ]);
  });

  it('refuses a field initialiser whose name the file does not state, and warns', async () => {
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}
import org.springframework.beans.factory.annotation.Value;

public class DealEvents {
  @Value("\${deals.topic}")
  private String configured;

  private final Publisher publisher =
      Publisher.newBuilder(TopicName.of("deals", configured)).build();
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
    expect(warnings(fragment)).toContain('does not name literally');
  });
});

describe('Java Pub/Sub templates reached through a getter (epic-16)', () => {
  const TEMPLATE_IMPORT = 'import com.google.cloud.spring.pubsub.core.PubSubTemplate;';

  it('resolves a getter whose body is a plain field return, bare or through this', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents {
  private final PubSubTemplate template = null;

  public PubSubTemplate getPubSubTemplate() {
    return this.template;
  }

  public PubSubTemplate template() {
    return template;
  }

  public void publishDeal(String payload) {
    getPubSubTemplate().publish("deal-events", payload);
  }

  public void consume() {
    this.template().subscribe("deal-events-worker", message -> message.ack());
  }
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.publishDeal->topic:deal-events`,
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.consume->subscription:deal-events-worker`,
    ]);
  });

  it('refuses a computed getter, a getter with arguments, and one this file never declares', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents extends BaseEvents {
  private final PubSubTemplate template = null;
  private final PubSubTemplate fallback = null;

  public PubSubTemplate computed() {
    return template == null ? fallback : template;
  }

  public PubSubTemplate parameterised(String which) {
    return template;
  }

  public void a(String payload) {
    computed().publish("computed-topic", payload);
  }

  public void b(String payload) {
    parameterised("x").publish("parameterised-topic", payload);
  }

  public void c(String payload) {
    getInheritedTemplate().publish("inherited-topic", payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('refuses a getter declared on an interface, which has no body to read', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

interface HasTemplate {
  PubSubTemplate getPubSubTemplate();
}

class DealEvents implements HasTemplate {
  public void publishDeal(String payload) {
    getPubSubTemplate().publish("deal-events", payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('refuses another object’s getter, however plausibly it is named', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents {
  private final Other other = null;

  public void publishDeal(String payload) {
    other.getPubSubTemplate().publish("deal-events", payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
  });
});

describe('Java Pub/Sub resource-path strings (epic-16)', () => {
  it('reads projects/<p>/topics/<t> and projects/<p>/subscriptions/<s>, last segment as the name', async () => {
    // The LAST segment is the name, so this lands on the very same node ids the Terraform
    // resource, the Python consumer and `TopicName.of(project, topic)` all produce (§C13).
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  public void start() throws Exception {
    Publisher.newBuilder("projects/deals/topics/deal-events").build();
    Subscriber.newBuilder("projects/deals/subscriptions/deal-events-worker", null).build();
  }
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.start->topic:deal-events`,
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.start->subscription:deal-events-worker`,
    ]);
  });

  it('does not relabel a subscription path handed to the topic builder', async () => {
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  public void start() throws Exception {
    Publisher.newBuilder("projects/deals/subscriptions/deal-events-worker").build();
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('refuses every string that is not the resource-path grammar, and warns', async () => {
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  public void start() throws Exception {
    Publisher.newBuilder("deal-events").build();
    Publisher.newBuilder("projects/deals/topics/").build();
    Publisher.newBuilder("projects/deals/queues/deal-events").build();
    Publisher.newBuilder("projects/deals/topics/a/b").build();
    Publisher.newBuilder("/projects/deals/topics/deal-events").build();
    Publisher.newBuilder("").build();
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
    expect(warnings(fragment)).toContain('does not name literally');
  });

  // PRD §42.5 — a resource path is untrusted repository text reaching a new parse path.
  it('survives hostile resource paths without crashing or losing the rest of the file', async () => {
    const hostile = [
      'projects/p/topics/../../../../etc/passwd',
      'projects/p/topics/__proto__',
      'projects/p/topics/constructor',
      'projects/p/topics/toString',
      `projects/p/topics/${'a'.repeat(5000)}`,
      "projects/p/topics/'; DROP TABLE nodes; --",
    ];
    const calls = hostile
      .map((path) => `    Publisher.newBuilder(${JSON.stringify(path)}).build();`)
      .join('\n');
    const fragment = await index(`package com.example;

${NATIVE_IMPORTS}

public class DealEvents {
  public void start() throws Exception {
${calls}
  }

  public void control() {}
}
`);
    // A path segment containing `/` is not one segment, so the traversal string names nothing.
    expect(integration(fragment)).not.toContain('topic:../../../../etc/passwd');
    for (const node of fragment.nodes.filter((candidate) => candidate.category === 'integration')) {
      expect(node.type).toBe('topic');
      expect(typeof node.name).toBe('string');
    }
    // Prototype keys are values here, never resolved functions, and the file still indexes (§34).
    expect(integration(fragment)).toContain('topic:__proto__');
    expect(integration(fragment)).toContain('topic:constructor');
    expect(fragment.nodes.some((node) => node.id === `symbol:${FILE}#DealEvents.control`)).toBe(
      true,
    );
  });
});
