import { describe, expect, it } from 'vitest';

import { createJavaAdapter } from './java-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// Story 16.3 — Java/Spring Pub/Sub client detection (PRD §15.2, epic-16 line 202). Written as the
// same negative space as the TypeScript and Python suites: a WRONG topic name is the failure mode
// that matters, because it would correlate against a real Terraform resource and look convincing.
//
// The node ids asserted here (`topic:<name>`, `subscription:<name>`) are deliberately the same
// ones the other two adapters emit — that identity is what makes a Java publisher and a Python
// consumer of `deal-events` one node in the cross-stack graph (§C13).

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-pubsub-java',
  analysisRunId: 'run-pubsub-java',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (
  content: string,
  relativePath = 'src/main/java/com/example/DealEvents.java',
): Promise<GraphFragment> => createJavaAdapter().indexFiles([{ relativePath, content }], CONTEXT);

const FILE = 'src/main/java/com/example/DealEvents.java';

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

const warnings = (fragment: GraphFragment): string[] =>
  fragment.warnings.map((warning) => warning.message);

describe('Java Pub/Sub client detection (Story 16.3)', () => {
  it('detects PubSubTemplate publish and subscribe through an injected field', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import org.springframework.stereotype.Service;

@Service
public class DealEvents {
  private final PubSubTemplate pubSubTemplate;

  public DealEvents(PubSubTemplate pubSubTemplate) {
    this.pubSubTemplate = pubSubTemplate;
  }

  public void publishDeal(String payload) {
    this.pubSubTemplate.publish("deal-events", payload);
  }

  public void consumeDeals() {
    pubSubTemplate.subscribe("deal-events-worker", message -> message.ack());
  }
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.publishDeal->topic:deal-events`,
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.consumeDeals->subscription:deal-events-worker`,
    ]);
  });

  it('every emitted node and edge carries framework-convention provenance, never static-analysis', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;

public class DealEvents {
  private final PubSubTemplate pubSubTemplate = null;

  public void publishDeal(String payload) {
    pubSubTemplate.publish("deal-events", payload);
  }
}
`);
    const nodes = fragment.nodes.filter((node) => node.category === 'integration');
    expect(nodes).toHaveLength(1);
    for (const node of nodes) {
      expect(node.knowledge.provenance).toBe('framework-convention');
      expect(node.knowledge.evidenceIds.length).toBeGreaterThan(0);
      expect(node.knowledge.repositorySnapshotId).toBe('snap-pubsub-java');
    }
    for (const edge of fragment.edges.filter((candidate) => candidate.type === 'PUBLISHES')) {
      expect(edge.knowledge.provenance).toBe('framework-convention');
      expect(edge.knowledge.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it('detects the native Publisher and Subscriber builders through TopicName.of', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.pubsub.v1.Publisher;
import com.google.cloud.pubsub.v1.Subscriber;
import com.google.pubsub.v1.ProjectSubscriptionName;
import com.google.pubsub.v1.TopicName;

public class DealEvents {
  public void start() throws Exception {
    TopicName topicName = TopicName.of("deals", "deal-events");
    Publisher publisher = Publisher.newBuilder(topicName).build();
    Subscriber subscriber =
        Subscriber.newBuilder(ProjectSubscriptionName.of("deals", "deal-events-worker"), null)
            .build();
  }
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.start->topic:deal-events`,
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.start->subscription:deal-events-worker`,
    ]);
  });

  it('links a @ServiceActivator handler to the subscription its channel carries', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import com.google.cloud.spring.pubsub.integration.inbound.PubSubInboundChannelAdapter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.integration.annotation.ServiceActivator;
import org.springframework.integration.channel.DirectChannel;
import org.springframework.messaging.MessageChannel;

@Configuration
public class DealEvents {
  @ServiceActivator(inputChannel = "pubsubInputChannel")
  public void onDealEvent(String payload) {}

  @Bean
  public MessageChannel pubsubInputChannel() {
    return new DirectChannel();
  }

  @Bean
  public PubSubInboundChannelAdapter inboundAdapter(
      @Qualifier("pubsubInputChannel") MessageChannel inputChannel, PubSubTemplate template) {
    PubSubInboundChannelAdapter adapter =
        new PubSubInboundChannelAdapter(template, "deal-events-worker");
    adapter.setOutputChannel(inputChannel);
    return adapter;
  }
}
`);
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker']);
    // Both ends: the @Bean that creates the adapter, and the handler that receives the messages.
    expect(pubsubEdges(fragment)).toEqual([
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.inboundAdapter->subscription:deal-events-worker`,
      `SUBSCRIBES_TO|symbol:${FILE}#DealEvents.onDealEvent->subscription:deal-events-worker`,
    ]);
  });

  it('two publishes to one topic produce one node and one edge per publishing method', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;

public class DealEvents {
  private final PubSubTemplate pubSubTemplate = null;

  public void publishOnce(String payload) {
    pubSubTemplate.publish("deal-events", payload);
    pubSubTemplate.publish("deal-events", payload);
  }

  public void publishTwice(String payload) {
    pubSubTemplate.publish("deal-events", payload);
  }
}
`);
    expect(integration(fragment)).toEqual(['topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      `PUBLISHES|symbol:${FILE}#DealEvents.publishOnce->topic:deal-events`,
      `PUBLISHES|symbol:${FILE}#DealEvents.publishTwice->topic:deal-events`,
    ]);
  });
});

// What the adapter must REFUSE. These matter more than the positive cases: a topic name this
// adapter invents would correlate against a real Terraform resource and look entirely convincing.
describe('Java Pub/Sub detection — refusals (Story 16.3, PRD §35)', () => {
  it('leaves a @ServiceActivator on an unbound channel unlinked, and says so', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import org.springframework.integration.annotation.ServiceActivator;

public class DealEvents {
  private final PubSubTemplate pubSubTemplate = null;

  @ServiceActivator(inputChannel = "someOtherChannel")
  public void onDealEvent(String payload) {}
}
`);
    expect(pubsubEdges(fragment)).toEqual([]);
    expect(warnings(fragment).join('\n')).toContain("channel 'someOtherChannel'");
  });

  it('refuses a topic name the source does not state literally, and warns instead', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import org.springframework.beans.factory.annotation.Value;

public class DealEvents {
  private final PubSubTemplate pubSubTemplate = null;

  @Value("\${deals.topic}")
  private String topicName;

  public void publishDeal(String payload) {
    pubSubTemplate.publish(topicName, payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
    expect(warnings(fragment).join('\n')).toContain('does not state');
  });

  it('never matches a same-named class that is not the Pub/Sub client', async () => {
    const fragment = await index(`package com.example;

import com.example.internal.PubSubTemplate;
import com.example.internal.Publisher;
import com.example.internal.TopicName;

public class DealEvents {
  private final PubSubTemplate pubSubTemplate = null;

  public void publishDeal(String payload) {
    pubSubTemplate.publish("deal-events", payload);
    Publisher.newBuilder(TopicName.of("deals", "deal-events")).build();
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('ignores a file that imports no Pub/Sub client at all', async () => {
    const fragment = await index(`package com.example;

public class DealEvents {
  public void publishDeal(String payload) {
    PubSubTemplate template = null;
    template.publish("deal-events", payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });

  it('reads the SECOND argument of TopicName.of, never "the last literal"', async () => {
    // `TopicName.of("deals", propertyDrivenName)` states a PROJECT and an unknown topic. Taking
    // the last literal would publish `deals` as a topic — a name the source never stated.
    const fragment = await index(`package com.example;

import com.google.cloud.pubsub.v1.Publisher;
import com.google.pubsub.v1.TopicName;

public class DealEvents {
  private String configured;

  public void start() throws Exception {
    Publisher.newBuilder(TopicName.of("deals", configured)).build();
  }
}
`);
    expect(integration(fragment)).toEqual([]);
  });

  it('does not relabel a subscription as a topic when the builder shapes disagree', async () => {
    const fragment = await index(`package com.example;

import com.google.cloud.pubsub.v1.Publisher;
import com.google.pubsub.v1.ProjectSubscriptionName;

public class DealEvents {
  public void start() throws Exception {
    Publisher.newBuilder(ProjectSubscriptionName.of("deals", "deal-events-worker")).build();
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
  });
});
