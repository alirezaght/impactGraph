import { describe, expect, it } from 'vitest';

import { PUBSUB_ENV_RECEIVER } from './pubsub-facts.js';
import { createPythonAdapter } from './python/python-adapter.js';
import { createTerraformAdapter } from './terraform/terraform-adapter.js';
import { CLOUD_RUN_ENV_RECEIVER } from './terraform/terraform-graph.js';
import { createTypeScriptAdapter } from './typescript/typescript-adapter.js';

import type { GraphFragment, IndexingContext, LanguageAdapter } from './types.js';

// The two halves of the Cloud Run env correspondence, as the LANGUAGE adapters record them
// (epic-16). Neither half is a topic name and neither may produce a node here; the join lives in
// `framework-adapters/cross-stack/cloud-run-env.ts` and is tested there.
//
// The refusals are the point of this file. Each positive shape is matched by the shape one step
// away that must record nothing.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-env',
  analysisRunId: 'run-env',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (
  adapter: LanguageAdapter,
  relativePath: string,
  content: string,
): Promise<GraphFragment> => adapter.indexFiles([{ relativePath, content }], CONTEXT);

/** `<kind>:<envName>@<sourceId>` for every env fact, so a wrong owner fails too. */
const envFacts = (fragment: GraphFragment): string[] =>
  fragment.callFacts
    .filter((fact) => fact.receiverName === PUBSUB_ENV_RECEIVER)
    .map(
      (fact) =>
        `${fact.stringArguments[0] ?? ''}:${fact.calleeName}@${fact.enclosingSymbolNodeId ?? ''}`,
    )
    .sort();

const integrationNodes = (fragment: GraphFragment): string[] =>
  fragment.nodes.filter((node) => node.category === 'integration').map((node) => String(node.id));

const TS_IMPORT = "import { PubSub } from '@google-cloud/pubsub';\nconst pubsub = new PubSub();\n";

const typescript = (body: string): Promise<GraphFragment> =>
  index(createTypeScriptAdapter(), 'src/publisher.ts', `${TS_IMPORT}${body}`);

const PY_HEADER =
  'import os\nfrom google.cloud import pubsub_v1\n\npublisher = pubsub_v1.PublisherClient()\nsubscriber = pubsub_v1.SubscriberClient()\n';

const python = (body: string): Promise<GraphFragment> =>
  index(createPythonAdapter(), 'app/events.py', `${PY_HEADER}${body}`);

describe('TypeScript: process.env as a Pub/Sub resource name (epic-16)', () => {
  it('records the environment variable name and creates no topic node', async () => {
    const fragment = await typescript(`export async function publish(deal: unknown) {
  await pubsub.topic(process.env.DEAL_EVENTS_TOPIC!).publishMessage({ json: deal });
}
`);
    expect(envFacts(fragment)).toEqual(['topic:DEAL_EVENTS_TOPIC@symbol:src/publisher.ts#publish']);
    expect(integrationNodes(fragment)).toEqual([]);
  });

  it('reads the bracket form and records a subscription read as a subscription', async () => {
    const fragment = await typescript(`export function consume() {
  pubsub.subscription(process.env['WORKER_SUB']).on('message', () => {});
}
`);
    expect(envFacts(fragment)).toEqual(['subscription:WORKER_SUB@symbol:src/publisher.ts#consume']);
  });

  it('refuses a fallback, a destructured name, and an indirect env alias', async () => {
    const fragment = await typescript(`const { OTHER_TOPIC } = process.env;
const env = process.env;
export async function a(d: unknown) {
  await pubsub.topic(process.env.WITH_FALLBACK ?? 'deal-events').publishMessage({ json: d });
}
export async function b(d: unknown) {
  await pubsub.topic(OTHER_TOPIC!).publishMessage({ json: d });
}
export async function c(d: unknown) {
  await pubsub.topic(env.INDIRECT!).publishMessage({ json: d });
}
`);
    expect(envFacts(fragment)).toEqual([]);
    expect(integrationNodes(fragment)).toEqual([]);
  });

  it('still records nothing for a parameter — the value is stated nowhere at all', async () => {
    const fragment = await typescript(`export async function publish(topic: string) {
  await pubsub.topic(topic).publishMessage({ json: {} });
}
`);
    expect(envFacts(fragment)).toEqual([]);
    expect(integrationNodes(fragment)).toEqual([]);
  });

  it('treats a prototype-named variable as untrusted text, not as a lookup hit', async () => {
    const fragment = await typescript(`export async function publish(d: unknown) {
  await pubsub.topic(process.env.constructor).publishMessage({ json: d });
}
`);
    // `constructor` IS a legal environment variable name — the fact is recorded, and it is only
    // ever a string. What must not happen is a node, or a prototype value leaking in as one.
    expect(envFacts(fragment)).toEqual(['topic:constructor@symbol:src/publisher.ts#publish']);
    expect(integrationNodes(fragment)).toEqual([]);
  });
});

describe('Python: os.environ as a Pub/Sub resource name (epic-16)', () => {
  it('records the variable name from a subscript and from os.getenv', async () => {
    const fragment = await python(`PROJECT = "deals"
events = publisher.topic_path(PROJECT, os.environ["DEAL_EVENTS_TOPIC"])
worker = subscriber.subscription_path(PROJECT, os.getenv("WORKER_SUB"))


def publish(payload: bytes) -> None:
    publisher.publish(events, payload)


def consume() -> None:
    subscriber.subscribe(worker, callback=None)
`);
    expect(envFacts(fragment)).toEqual([
      'subscription:WORKER_SUB@symbol:app/events.py#consume',
      'topic:DEAL_EVENTS_TOPIC@symbol:app/events.py#publish',
    ]);
    expect(integrationNodes(fragment)).toEqual([]);
  });

  it('refuses os.getenv with a default and a module that never imports os', async () => {
    const withDefault =
      await python(`events = publisher.topic_path("p", os.getenv("T", "deal-events"))


def publish(payload: bytes) -> None:
    publisher.publish(events, payload)
`);
    expect(envFacts(withDefault)).toEqual([]);

    const noImport = await index(
      createPythonAdapter(),
      'app/events.py',
      `from google.cloud import pubsub_v1

publisher = pubsub_v1.PublisherClient()
events = publisher.topic_path("p", os.environ["T"])


def publish(payload: bytes) -> None:
    publisher.publish(events, payload)
`,
    );
    expect(envFacts(noImport)).toEqual([]);
  });

  it('never reads the PROJECT argument as the topic when the topic is an env read', async () => {
    const fragment = await python(`events = publisher.topic_path("deals", os.environ["T"])


def publish(payload: bytes) -> None:
    publisher.publish(events, payload)
`);
    expect(integrationNodes(fragment)).toEqual([]);
    expect(envFacts(fragment)).toEqual(['topic:T@symbol:app/events.py#publish']);
  });
});

const terraform = (content: string): Promise<GraphFragment> =>
  index(createTerraformAdapter(), 'infra/main.tf', content);

const envBindings = (fragment: GraphFragment): string[] =>
  fragment.callFacts
    .filter((fact) => fact.receiverName === CLOUD_RUN_ENV_RECEIVER)
    .map((fact) => `${fact.stringArguments[0] ?? ''}=${fact.calleeName}`)
    .sort();

const RESOURCES = `
resource "google_pubsub_topic" "deal_events" {
  name = "deal-events"
}
`;

describe('Terraform: container env bindings (epic-16)', () => {
  it('records a literal name bound to a resource reference, at any nesting depth', async () => {
    const fragment = await terraform(`${RESOURCES}
resource "google_cloud_run_v2_job" "worker" {
  name = "deals-worker"
  template {
    template {
      containers {
        env {
          name  = "DEAL_EVENTS_TOPIC"
          value = google_pubsub_topic.deal_events.name
        }
      }
    }
  }
}
`);
    expect(envBindings(fragment)).toEqual(['DEAL_EVENTS_TOPIC=google_pubsub_topic.deal_events']);
  });

  it('records nothing for a literal value, an interpolation, or a missing name', async () => {
    const fragment = await terraform(`${RESOURCES}
resource "google_cloud_run_v2_job" "worker" {
  name = "deals-worker"
  template {
    containers {
      env {
        name  = "LITERAL"
        value = "deal-events"
      }
      env {
        name  = "INTERPOLATED"
        value = "\${google_pubsub_topic.deal_events.name}-dlq"
      }
      env {
        value = google_pubsub_topic.deal_events.name
      }
      env {
        name  = "\${var.prefix}_TOPIC"
        value = google_pubsub_topic.deal_events.name
      }
    }
  }
}
`);
    expect(envBindings(fragment)).toEqual([]);
  });

  it('reads the same binding out of Terraform JSON syntax and refuses a wrapped expression', async () => {
    const fragment = await index(
      createTerraformAdapter(),
      'infra/main.tf.json',
      JSON.stringify({
        resource: {
          google_cloud_run_v2_job: {
            worker: {
              name: 'deals-worker',
              template: {
                containers: {
                  env: [
                    { name: 'DEAL_EVENTS_TOPIC', value: '${google_pubsub_topic.deal_events.name}' },
                    { name: 'WRAPPED', value: '${lower(google_pubsub_topic.deal_events.name)}' },
                    { name: 'SUFFIXED', value: '${google_pubsub_topic.deal_events.name}-dlq' },
                  ],
                },
              },
            },
          },
        },
      }),
    );
    expect(envBindings(fragment)).toEqual(['DEAL_EVENTS_TOPIC=google_pubsub_topic.deal_events']);
  });
});
