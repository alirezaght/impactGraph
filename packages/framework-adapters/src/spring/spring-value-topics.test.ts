import {
  PUBSUB_CONFIG_NAME_RECEIVER,
  SPRING_PROPERTY_RECEIVER,
} from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createSpringAdapter } from './spring-adapter.js';

import type { CodeGraph } from '../types.js';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CallFact, DecoratorFact, GraphFragment } from '@impactgraph/language-adapters';

// `@Value("${deals.topic}")` resolved against the module's own Spring configuration (epic-16).
//
// The happy path is pinned end-to-end by `packages/test-kit/goldens/java-spring.graph.txt`. What
// belongs here is every way the join must produce NOTHING — an invented topic name correlates
// against real infrastructure and looks entirely convincing, which is the failure this guards.

const CONTEXT = {
  repositorySnapshotId: 'snap-value',
  analysisRunId: 'run-value',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev:node'] as readonly string[],
  confidence: { value: 1, signals: [] },
  createdAt: CONTEXT.createdAt,
  repositorySnapshotId: CONTEXT.repositorySnapshotId,
  analysisRunId: CONTEXT.analysisRunId,
};

const SOURCE = 'src/main/java/com/example/deals/DealEventPublisher.java';
const CLASS_PREFIX = `symbol:${SOURCE}#DealEventPublisher`;
const PUBLISH_METHOD = `${CLASS_PREFIX}.publishAudit`;

const node = (id: string, type: string, name: string): GraphNode =>
  ({ id, category: 'application', type, name, path: SOURCE, knowledge }) as unknown as GraphNode;

/** The `@Value` the Java adapter recorded on a field, with `Service` alongside so Spring detects. */
const valueAnnotation = (field: string, placeholder: string): DecoratorFact => ({
  targetNodeId: `${CLASS_PREFIX}.${field}`,
  decoratorName: 'Value',
  stringArguments: [placeholder],
  identifierLists: {},
  filePath: SOURCE,
  evidenceId: `ev:decorator:${field}`,
});

const SERVICE_ANNOTATION: DecoratorFact = {
  targetNodeId: CLASS_PREFIX,
  decoratorName: 'Service',
  stringArguments: [],
  identifierLists: {},
  filePath: SOURCE,
  evidenceId: 'ev:decorator:Service',
};

/** `pubSubTemplate.publish(<field>, …)` as the Java adapter records it when it cannot value it. */
const configNameFact = (field: string, kind = 'topic'): CallFact => ({
  filePath: SOURCE,
  receiverName: PUBSUB_CONFIG_NAME_RECEIVER,
  calleeName: field,
  stringArguments: [kind],
  identifierArguments: [],
  enclosingSymbolNodeId: PUBLISH_METHOD,
  evidenceId: `ev:call:${field}`,
});

const propertyFact = (
  key: string,
  value: string,
  filePath = 'src/main/resources/application.yml',
): CallFact => ({
  filePath,
  receiverName: SPRING_PROPERTY_RECEIVER,
  calleeName: key,
  stringArguments: [value],
  identifierArguments: [],
  enclosingSymbolNodeId: `file:${filePath}`,
  evidenceId: `ev:config:${filePath}:${key}`,
});

const graphOf = (decorators: DecoratorFact[], callFacts: CallFact[]): CodeGraph => ({
  nodes: [node(CLASS_PREFIX, 'class', 'DealEventPublisher'), node(PUBLISH_METHOD, 'method', 'x')],
  edges: [] as readonly GraphEdge[],
  decorators: [SERVICE_ANNOTATION, ...decorators],
  callFacts,
  symbolReferences: [],
  resolveSymbol: () => undefined,
  importsOf: () => [],
});

const enrich = (graph: CodeGraph): Promise<GraphFragment> =>
  createSpringAdapter().enrich(graph, {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });

const pubsub = (fragment: GraphFragment): string[] =>
  fragment.edges
    .filter((edge) => edge.type === 'PUBLISHES' || edge.type === 'SUBSCRIBES_TO')
    .map((edge) => `${edge.type}|${edge.sourceId}->${edge.targetId}`)
    .sort();

const topicNodes = (fragment: GraphFragment): string[] =>
  fragment.nodes
    .filter((entry) => entry.category === 'integration')
    .map((entry) => String(entry.id));

describe('Spring @Value → configuration (epic-16): what resolves', () => {
  it('resolves a key the module states, citing the annotation AND the config entry', async () => {
    const fragment = await enrich(
      graphOf(
        [valueAnnotation('auditTopic', '${deals.events-topic}')],
        [configNameFact('auditTopic'), propertyFact('deals.events-topic', 'deal-audit-events')],
      ),
    );
    expect(topicNodes(fragment)).toEqual(['topic:deal-audit-events']);
    expect(pubsub(fragment)).toEqual([`PUBLISHES|${PUBLISH_METHOD}->topic:deal-audit-events`]);
    const edge = fragment.edges.find((entry) => entry.type === 'PUBLISHES');
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect([...(edge?.knowledge.evidenceIds ?? [])]).toEqual([
      'ev:decorator:auditTopic',
      'ev:config:src/main/resources/application.yml:deals.events-topic',
    ]);
  });

  it('uses the default written in the annotation when the configuration is silent', async () => {
    const fragment = await enrich(
      graphOf([valueAnnotation('t', '${deals.topic:deal-fallback}')], [configNameFact('t')]),
    );
    expect(topicNodes(fragment)).toEqual(['topic:deal-fallback']);
    // Only one site exists to cite, and it is the annotation itself.
    const edge = fragment.edges.find((entry) => entry.type === 'PUBLISHES');
    expect([...(edge?.knowledge.evidenceIds ?? [])]).toEqual(['ev:decorator:t']);
  });

  it('prefers the stated value over the annotation default, and honours the kind', async () => {
    const fragment = await enrich(
      graphOf(
        [valueAnnotation('s', '${deals.sub:ignored-default}')],
        [configNameFact('s', 'subscription'), propertyFact('deals.sub', 'deal-events-worker')],
      ),
    );
    expect(pubsub(fragment)).toEqual([
      `SUBSCRIBES_TO|${PUBLISH_METHOD}->subscription:deal-events-worker`,
    ]);
  });
});

describe('Spring @Value → configuration (epic-16): what resolves to nothing', () => {
  const refuses = async (
    decorators: DecoratorFact[],
    callFacts: CallFact[],
  ): Promise<GraphFragment> => {
    const fragment = await enrich(graphOf(decorators, callFacts));
    expect(topicNodes(fragment)).toEqual([]);
    expect(pubsub(fragment)).toEqual([]);
    return fragment;
  };

  it('an unresolvable key with no default', async () => {
    const fragment = await refuses(
      [valueAnnotation('t', '${deals.audit-topic}')],
      [configNameFact('t'), propertyFact('deals.other', 'deal-events')],
    );
    expect(fragment.warnings.some((w) => w.message.includes('states'))).toBe(true);
  });

  it('a value that is itself a placeholder — nothing is expanded twice', async () => {
    await refuses(
      [valueAnnotation('t', '${deals.topic}')],
      [configNameFact('t'), propertyFact('deals.topic', '${OTHER_TOPIC}')],
    );
  });

  it('a profile-specific override that disagrees', async () => {
    const fragment = await refuses(
      [valueAnnotation('t', '${deals.topic}')],
      [
        configNameFact('t'),
        propertyFact('deals.topic', 'deal-events'),
        propertyFact('deals.topic', 'deal-events-prod', 'src/main/resources/application-prod.yml'),
      ],
    );
    expect(fragment.warnings.some((w) => w.message.includes('active profile'))).toBe(true);
  });

  it('a profile override that AGREES still resolves — it is not a disagreement', async () => {
    const fragment = await enrich(
      graphOf(
        [valueAnnotation('t', '${deals.topic}')],
        [
          configNameFact('t'),
          propertyFact('deals.topic', 'deal-events'),
          propertyFact('deals.topic', 'deal-events', 'src/main/resources/application-prod.yml'),
        ],
      ),
    );
    expect(topicNodes(fragment)).toEqual(['topic:deal-events']);
  });

  it('a key stated only by ANOTHER module', async () => {
    await refuses(
      [valueAnnotation('t', '${deals.topic}')],
      [
        configNameFact('t'),
        propertyFact('deals.topic', 'deal-events', 'other/src/main/resources/application.yml'),
      ],
    );
  });

  it('a composite annotation argument, and a bare literal one', async () => {
    await refuses(
      [valueAnnotation('t', 'topics-${deals.env}')],
      [configNameFact('t'), propertyFact('deals.env', 'prod')],
    );
    await refuses(
      [valueAnnotation('u', 'deal-events')],
      [configNameFact('u'), propertyFact('deals.topic', 'deal-events')],
    );
  });

  it('a field with no @Value at all — the value is stated nowhere', async () => {
    await refuses(
      [],
      [configNameFact('someParameter'), propertyFact('deals.topic', 'deal-events')],
    );
  });

  it('a configured value that is a resource path or carries whitespace, not a bare name', async () => {
    await refuses(
      [valueAnnotation('t', '${deals.topic}')],
      [configNameFact('t'), propertyFact('deals.topic', 'projects/p/topics/deal-events')],
    );
    await refuses(
      [valueAnnotation('u', '${deals.topic}')],
      [configNameFact('u'), propertyFact('deals.topic', 'deal events')],
    );
  });

  it('a prototype-named key is a miss, not an inherited value (PRD §42.5)', async () => {
    await refuses([valueAnnotation('t', '${constructor}')], [configNameFact('t')]);
    await refuses([valueAnnotation('u', '${__proto__}')], [configNameFact('u')]);
  });
});
