import { describe, expect, it } from 'vitest';

import { createTypeScriptAdapter } from './typescript-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// epic-16 — a topic name held in a module-level constant (`pubsub-constants.ts`). Split from
// `pubsub-detection.test.ts`, which is at its effective-LOC limit.
//
// The line this suite defends: `const TOPIC = 'deal-events'` STATES the value, so reporting it is
// reading the file, while `process.env.TOPIC`, a parameter, or an import does not state it
// anywhere in this repository, and emitting a node for those would invent a fact (§35). Everything
// below is one or the other side of that line.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-pubsub-const',
  analysisRunId: 'run-pubsub-const',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (content: string, relativePath = 'src/publisher.ts'): Promise<GraphFragment> =>
  createTypeScriptAdapter().indexFiles([{ relativePath, content }], CONTEXT);

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

const IMPORT = "import { PubSub } from '@google-cloud/pubsub';\n";

describe('TypeScript Pub/Sub names held in a module constant (epic-16)', () => {
  it('propagates a const string into topic() and subscription()', async () => {
    const fragment = await index(
      `${IMPORT}const TOPIC = 'deal-events';
const SUBSCRIPTION = 'deal-events-worker';
const pubsub = new PubSub();

export async function publishDeal(deal: unknown): Promise<void> {
  await pubsub.topic(TOPIC).publishMessage({ json: deal });
}

export function consume(): void {
  pubsub.subscription(SUBSCRIPTION).on('message', () => {});
}
`,
    );
    expect(integration(fragment)).toEqual(['subscription:deal-events-worker', 'topic:deal-events']);
    expect(pubsubEdges(fragment)).toEqual([
      'PUBLISHES|symbol:src/publisher.ts#publishDeal->topic:deal-events',
      'SUBSCRIBES_TO|symbol:src/publisher.ts#consume->subscription:deal-events-worker',
    ]);
  });

  it('lands on the same node id a literal would, so the Terraform correlation is unaffected', async () => {
    const viaConstant = await index(
      `${IMPORT}const TOPIC = 'deal-events';
const pubsub = new PubSub();
void pubsub.topic(TOPIC).publishJSON({});
`,
    );
    const viaLiteral = await index(
      `${IMPORT}const pubsub = new PubSub();
void pubsub.topic('deal-events').publishJSON({});
`,
    );
    expect(integration(viaConstant)).toEqual(integration(viaLiteral));
    expect(pubsubEdges(viaConstant)).toEqual(pubsubEdges(viaLiteral));
  });

  it('carries framework-convention provenance and call-site evidence, as every other fact does', async () => {
    const fragment = await index(
      `${IMPORT}const TOPIC = 'deal-events';
const pubsub = new PubSub();
export function publishDeal(): void {
  void pubsub.topic(TOPIC).publishMessage({});
}
`,
    );
    const topic = fragment.nodes.find((node) => node.id === 'topic:deal-events');
    const edge = fragment.edges.find((candidate) => candidate.type === 'PUBLISHES');
    expect(topic?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect(topic?.knowledge.repositorySnapshotId).toBe('snap-pubsub-const');
    // A real range over the `pubsub.topic(TOPIC).publishMessage({})` call — the reviewer opens the
    // call site, and the constant it reads is two lines above it in the same file.
    expect(citedRanges(fragment, edge?.knowledge.evidenceIds ?? [])).toEqual(['5:8-5:46']);
  });

  it('reads a hole-free template literal, which states its value completely', async () => {
    const fragment = await index(
      `${IMPORT}const TOPIC = \`deal-events\`;
const pubsub = new PubSub();
void pubsub.topic(TOPIC).publishJSON({});
`,
    );
    expect(integration(fragment)).toEqual(['topic:deal-events']);
  });
});

// The refusals. Each of these is a name the repository does NOT state, and each would look
// entirely convincing as a topic node if the adapter guessed at it.
describe('TypeScript Pub/Sub constant propagation — refusals (§35)', () => {
  it('refuses a let, however obviously it looks constant', async () => {
    const fragment = await index(
      `${IMPORT}let topicName = 'deal-events';
const pubsub = new PubSub();
void pubsub.topic(topicName).publishJSON({});
`,
    );
    expect(integration(fragment)).toEqual([]);
  });

  it('refuses a const reassigned in the file, directly or through a cast', async () => {
    // Neither shape is valid TypeScript. Repository content is untrusted input that need not
    // compile (§42.5), and a write the adapter cannot see is a value it must not claim.
    for (const write of ['TOPIC = "other";', '(TOPIC as unknown as string) = "other";']) {
      const fragment = await index(
        `${IMPORT}const TOPIC = 'deal-events';
const pubsub = new PubSub();
export function rebind(): void {
  ${write}
}
void pubsub.topic(TOPIC).publishJSON({});
`,
      );
      expect(integration(fragment), write).toEqual([]);
    }
  });

  it('refuses a template literal with a hole rather than reporting its prefix', async () => {
    const fragment = await index(
      `${IMPORT}const env = process.env['ENV'] ?? 'dev';
const TOPIC = \`deal-\${env}\`;
const pubsub = new PubSub();
void pubsub.topic(TOPIC).publishJSON({});
`,
    );
    expect(integration(fragment)).toEqual([]);
  });

  it('refuses a name imported from another module, whose value this file cannot see', async () => {
    const fragment = await index(
      `${IMPORT}import { TOPIC } from './topics.js';
const pubsub = new PubSub();
void pubsub.topic(TOPIC).publishJSON({});
`,
    );
    expect(integration(fragment)).toEqual([]);
  });

  it('refuses a function parameter that shadows a module constant of the same name', async () => {
    const fragment = await index(
      `${IMPORT}const TOPIC = 'deal-events';
const pubsub = new PubSub();
export function publishTo(TOPIC: string): void {
  void pubsub.topic(TOPIC).publishJSON({});
}
`,
    );
    // The call site reads the PARAMETER. Resolving the module constant here would attach a
    // publication to a topic this function may never touch.
    expect(integration(fragment)).toEqual([]);
  });

  it('refuses a name two const declarations in one file disagree about', async () => {
    const fragment = await index(
      `${IMPORT}const pubsub = new PubSub();
export function a(): void {
  const TOPIC = 'topic-a';
  void pubsub.topic(TOPIC).publishJSON({});
}
export function b(): void {
  const TOPIC = 'topic-b';
  void pubsub.topic(TOPIC).publishJSON({});
}
`,
    );
    // The constant map is file-scoped while the bindings are not, so the honest answer is silence.
    expect(integration(fragment)).toEqual([]);
  });

  it('refuses a destructured const and a non-literal initialiser', async () => {
    const fragment = await index(
      `${IMPORT}const { TOPIC } = { TOPIC: 'deal-events' } as const;
const OTHER = String('deal-events');
const pubsub = new PubSub();
void pubsub.topic(TOPIC).publishJSON({});
void pubsub.topic(OTHER).publishJSON({});
`,
    );
    expect(integration(fragment)).toEqual([]);
  });

  // PRD §42.5 — a constant name is untrusted repository text used as a map key.
  it('does not resolve a prototype key through the constant map', async () => {
    const fragment = await index(
      `${IMPORT}const pubsub = new PubSub();
export function publishDeal(): void {
  void pubsub.topic(constructor).publishJSON({});
  void pubsub.topic(toString).publishJSON({});
}
`,
      'src/hostile-const.ts',
    );
    expect(integration(fragment)).toEqual([]);
    expect(
      fragment.nodes.some((node) => node.id === 'symbol:src/hostile-const.ts#publishDeal'),
    ).toBe(true);
  });
});
