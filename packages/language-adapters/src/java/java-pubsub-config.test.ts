import { describe, expect, it } from 'vitest';

import { PUBSUB_CONFIG_NAME_RECEIVER } from '../pubsub-facts.js';

import { createJavaAdapter } from './java-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// epic-16 — the identifier a `publish(x, …)` call names when `x` is not a literal. This adapter
// records the IDENTIFIER, never a topic name, and never a node: whether the repository states a
// value for it is a question about `@Value` and `application.yml`, which the Spring framework
// adapter answers (`framework-adapters/spring/spring-value-topics.ts`).

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-pubsub-java-config',
  analysisRunId: 'run-pubsub-java-config',
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

const warnings = (fragment: GraphFragment): string[] =>
  fragment.warnings.map((warning) => warning.message);

const configNameFacts = (fragment: GraphFragment): string[] =>
  fragment.callFacts
    .filter((fact) => fact.receiverName === PUBSUB_CONFIG_NAME_RECEIVER)
    .map(
      (fact) =>
        `${fact.stringArguments[0] ?? ''}:${fact.calleeName}@${fact.enclosingSymbolNodeId ?? ''}`,
    )
    .sort();

const TEMPLATE_IMPORT = 'import com.google.cloud.spring.pubsub.core.PubSubTemplate;';

describe('Java: a resource name this file does not state (epic-16)', () => {
  it('records the identifier and no node, warning that it needs a @Value placeholder', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents {
  private PubSubTemplate template;
  private String configuredTopic;

  public void publish(String payload) {
    template.publish(configuredTopic, payload);
  }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(pubsubEdges(fragment)).toEqual([]);
    expect(configNameFacts(fragment)).toEqual([
      `topic:configuredTopic@symbol:${FILE}#DealEvents.publish`,
    ]);
    expect(warnings(fragment).some((message) => message.includes('@Value placeholder'))).toBe(true);
  });

  it('records the identifier for a subscription-shaped call too', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents {
  private PubSubTemplate template;
  private String configuredSub;

  public void consume() {
    template.subscribe(configuredSub, message -> {});
  }
}
`);
    expect(configNameFacts(fragment)).toEqual([
      `subscription:configuredSub@symbol:${FILE}#DealEvents.consume`,
    ]);
  });

  it('records nothing for an argument that is not even an identifier', async () => {
    const fragment = await index(`package com.example;

${TEMPLATE_IMPORT}

public class DealEvents {
  private PubSubTemplate template;

  public void publish(String payload) {
    template.publish("deal-" + suffix(), payload);
    template.publish(resolve(), payload);
  }

  private String suffix() { return "x"; }
  private String resolve() { return "y"; }
}
`);
    expect(integration(fragment)).toEqual([]);
    expect(configNameFacts(fragment)).toEqual([]);
    expect(warnings(fragment).some((message) => message.includes('no node was created'))).toBe(
      true,
    );
  });
});
