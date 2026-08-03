import {
  CLOUD_RUN_ENV_RECEIVER,
  PUBSUB_ENV_RECEIVER,
  terraformNodeId,
} from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createCrossStackAdapter } from './cross-stack-adapter.js';

import type { CodeGraph } from '../types.js';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CallFact, GraphFragment } from '@impactgraph/language-adapters';

// "Cloud Run env becomes `process.env`" (PRD §C13) — the correspondence, and every way it must
// resolve to nothing. The happy path is pinned end-to-end by
// `packages/test-kit/goldens/cross-stack.graph.txt`; this file is the negative space, because a
// topic name invented here would correlate against real infrastructure and look convincing.

const CONTEXT = {
  repositorySnapshotId: 'snap-env',
  analysisRunId: 'run-env',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const knowledge = {
  provenance: 'configuration' as const,
  evidenceIds: ['ev:node'] as readonly string[],
  confidence: { value: 1, signals: [] },
  createdAt: CONTEXT.createdAt,
  repositorySnapshotId: CONTEXT.repositorySnapshotId,
  analysisRunId: CONTEXT.analysisRunId,
};

const INFRA = 'infra/main.tf';
const CODE_FILE = 'worker/src/publisher.ts';
const PUBLISHER = `symbol:${CODE_FILE}#publish`;
const JOB = terraformNodeId('infra', 'google_cloud_run_v2_job.worker');
const TOPIC = terraformNodeId('infra', 'google_pubsub_topic.deal_events');

const node = (id: string, type: string, name: string, path?: string): GraphNode =>
  ({ id, category: 'infrastructure', type, name, path, knowledge }) as unknown as GraphNode;

const edge = (type: string, sourceId: string, targetId: string): GraphEdge =>
  ({
    id: `${type}:${sourceId}->${targetId}`,
    type,
    sourceId,
    targetId,
    knowledge,
  }) as unknown as GraphEdge;

/** The Terraform half: `env { name = <envName> value = <address> }` on a Cloud Run resource. */
const envBinding = (envName: string, address: string, owner = JOB): CallFact => ({
  filePath: INFRA,
  receiverName: CLOUD_RUN_ENV_RECEIVER,
  calleeName: address,
  stringArguments: [envName],
  identifierArguments: [],
  enclosingSymbolNodeId: owner,
  evidenceId: `ev:tf:${envName}`,
});

/** The code half: `pubsub.topic(process.env.<envName>)`. */
const envRead = (envName: string, kind = 'topic', filePath = CODE_FILE): CallFact => ({
  filePath,
  receiverName: PUBSUB_ENV_RECEIVER,
  calleeName: envName,
  stringArguments: [kind],
  identifierArguments: [],
  enclosingSymbolNodeId: PUBLISHER,
  evidenceId: `ev:code:${envName}`,
});

interface World {
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
  readonly callFacts?: readonly CallFact[];
}

/** A package deployed as a Cloud Run job, containing one source file, plus a declared topic. */
const BASE_NODES: readonly GraphNode[] = [
  node('package:deals-worker', 'package', 'deals-worker', 'worker/package.json'),
  node(JOB, 'cloud-run-job', 'deals-worker', INFRA),
  node(TOPIC, 'pubsub-topic', 'deal-events', INFRA),
  node(PUBLISHER, 'function', 'publish', CODE_FILE),
];

const BASE_EDGES: readonly GraphEdge[] = [
  edge('CONTAINS', 'package:deals-worker', `file:${CODE_FILE}`),
];

const worldOf = (world: World): CodeGraph => ({
  nodes: [...BASE_NODES, ...(world.nodes ?? [])],
  edges: [...BASE_EDGES, ...(world.edges ?? [])],
  decorators: [],
  callFacts: world.callFacts ?? [],
  symbolReferences: [],
  resolveSymbol: () => undefined,
  importsOf: () => [],
});

const enrich = (world: World): Promise<GraphFragment> =>
  createCrossStackAdapter().enrich(worldOf(world), {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });

const usage = (fragment: GraphFragment): string[] =>
  fragment.edges
    .filter((entry) => entry.type === 'PUBLISHES' || entry.type === 'SUBSCRIBES_TO')
    .map((entry) => `${entry.type}|${entry.sourceId}->${entry.targetId}`)
    .sort();

const integrationNodes = (fragment: GraphFragment): string[] =>
  fragment.nodes
    .filter((entry) => entry.category === 'integration')
    .map((entry) => String(entry.id));

describe('Cloud Run env → Pub/Sub (PRD §C13): what correlates', () => {
  it('joins an env read to the topic the deployment sets that variable to', async () => {
    const fragment = await enrich({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
    expect(integrationNodes(fragment)).toEqual(['topic:deal-events']);
    expect(usage(fragment)).toEqual([`PUBLISHES|${PUBLISHER}->topic:deal-events`]);
  });

  it('cites both sides and carries framework-convention provenance', async () => {
    const fragment = await enrich({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
    const publishes = fragment.edges.find((entry) => entry.type === 'PUBLISHES');
    expect(publishes?.knowledge.provenance).toBe('framework-convention');
    expect([...(publishes?.knowledge.evidenceIds ?? [])]).toEqual([
      'ev:code:DEAL_EVENTS_TOPIC',
      'ev:tf:DEAL_EVENTS_TOPIC',
    ]);
  });

  it('links the topic it created to the resource it came from, so it is not orphaned', async () => {
    const fragment = await enrich({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
    expect(
      fragment.edges.some(
        (entry) =>
          entry.type === 'DEPLOYED_AS' &&
          entry.sourceId === 'topic:deal-events' &&
          entry.targetId === TOPIC,
      ),
    ).toBe(true);
  });
});

describe('Cloud Run env → Pub/Sub (PRD §C13): what resolves to nothing', () => {
  const refuses = async (world: World): Promise<void> => {
    const fragment = await enrich(world);
    expect(integrationNodes(fragment)).toEqual([]);
    expect(usage(fragment)).toEqual([]);
  };

  it('an environment variable name that differs by one character', async () => {
    await refuses({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENT_TOPIC'),
      ],
    });
  });

  it('a name that differs only in case — no folding, ever', async () => {
    await refuses({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('deal_events_topic'),
      ],
    });
  });

  it('a Terraform value that names no declared resource', async () => {
    await refuses({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.somewhere_else'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
  });

  it('a Terraform value that references something that is not a Pub/Sub resource', async () => {
    const bucket = terraformNodeId('infra', 'google_storage_bucket.uploads');
    await refuses({
      nodes: [node(bucket, 'terraform-resource', 'uploads', INFRA)],
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_storage_bucket.uploads'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
  });

  it('a referenced topic whose own name interpolates', async () => {
    const unnamed = terraformNodeId('infra', 'google_pubsub_topic.dynamic');
    await refuses({
      // A fallback name IS the address tail — the Terraform adapter saying "I cannot name this".
      nodes: [node(unnamed, 'pubsub-topic', 'google_pubsub_topic.dynamic', INFRA)],
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.dynamic'),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
  });

  it('a kind mismatch: a topic reference never answers a subscription read', async () => {
    await refuses({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENTS_TOPIC', 'subscription'),
      ],
    });
  });

  it('an env binding on a resource that is not Cloud Run', async () => {
    const other = terraformNodeId('infra', 'google_compute_instance.box');
    await refuses({
      nodes: [node(other, 'terraform-resource', 'box', INFRA)],
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events', other),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
  });

  it('a file the deployed package does not contain', async () => {
    await refuses({
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events'),
        envRead('DEAL_EVENTS_TOPIC', 'topic', 'other/src/publisher.ts'),
      ],
    });
  });

  it('a Cloud Run service no code node corresponds to', async () => {
    const orphan = terraformNodeId('infra', 'google_cloud_run_v2_service.unmatched');
    await refuses({
      nodes: [node(orphan, 'cloud-run-service', 'no-such-package', INFRA)],
      callFacts: [
        envBinding('DEAL_EVENTS_TOPIC', 'google_pubsub_topic.deal_events', orphan),
        envRead('DEAL_EVENTS_TOPIC'),
      ],
    });
  });

  it('an env read with no Terraform binding at all', async () => {
    await refuses({ callFacts: [envRead('UNMAPPED_TOPIC')] });
  });
});
