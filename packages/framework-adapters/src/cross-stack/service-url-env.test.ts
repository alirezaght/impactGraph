import { REFERENCE_RECEIVER } from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createCrossStackAdapter } from './cross-stack-adapter.js';

import type { CodeGraph } from '../types.js';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CallFact, GraphFragment } from '@impactgraph/language-adapters';

// "How does admin actually reach newsletter-service in production?" — the frontend reads
// NEWSLETTER_SERVICE_URL, the deployment assembles that URL in a Terraform service-URL map whose
// entry routes to the AGGREGATOR. Neither file names the other; what joins them is the deployment
// convention that the frontend's *_SERVICE_URL values come from that map. This test pins the one
// correspondence that makes the runtime walk reach the aggregator, and the refusals around it.

const CONTEXT = {
  repositorySnapshotId: 'snap-url',
  analysisRunId: 'run-url',
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
const MAP_BLOCK = 'terraform:infra/local.frontend_service_urls';
const MAP_URL = 'service-url:local.frontend_service_urls';
const ENV = 'env:NEWSLETTER_SERVICE_URL';

const node = (id: string, type: string, name: string, path?: string): GraphNode =>
  ({ id, category: 'infrastructure', type, name, path, knowledge }) as unknown as GraphNode;

const edge = (type: string, sourceId: string, targetId: string): GraphEdge =>
  ({
    id: `${type.toLowerCase()}:${sourceId}->${targetId}`,
    type,
    sourceId,
    targetId,
    knowledge,
  }) as unknown as GraphEdge;

/**
 * The map half: `frontend_service_urls = { newsletter = local._agg.newsletter }`. The language
 * adapter trims the address to the block (`local._agg`) and carries the entry selector
 * (`newsletter`) on the identifier channel — this mirrors that exactly.
 */
const mapEntryReference = (address: string, owner = MAP_BLOCK): CallFact => {
  const segments = address.split('.');
  return {
    filePath: INFRA,
    receiverName: REFERENCE_RECEIVER,
    calleeName: segments.slice(0, 2).join('.'),
    stringArguments: [],
    identifierArguments: segments.length > 2 ? [segments.slice(2).join('.')] : [],
    enclosingSymbolNodeId: owner,
    evidenceId: `ev:ref:${address}`,
  };
};

const BASE_NODES: readonly GraphNode[] = [
  node(ENV, 'environment-variable', 'NEWSLETTER_SERVICE_URL', 'apps/admin/src/client.ts'),
  node(MAP_URL, 'service-url', 'local.frontend_service_urls', INFRA),
  node(MAP_BLOCK, 'terraform-local', 'local.frontend_service_urls', INFRA),
];

interface World {
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
  readonly callFacts?: readonly CallFact[];
}

const worldOf = (world: World): CodeGraph => ({
  nodes: [...BASE_NODES, ...(world.nodes ?? [])],
  edges: [edge('RESOLVES_TO', MAP_URL, MAP_BLOCK), ...(world.edges ?? [])],
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

const urlLinks = (fragment: GraphFragment): string[] =>
  fragment.edges
    .filter((entry) => entry.type === 'RESOLVES_TO' && entry.sourceId.startsWith('env:'))
    .map((entry) => `${entry.sourceId}->${entry.targetId}`)
    .sort();

describe('frontend *_SERVICE_URL → Terraform service-URL map', () => {
  it('links the env var to the map whose entry names its stem', async () => {
    const fragment = await enrich({
      callFacts: [mapEntryReference('local._agg.newsletter')],
    });
    expect(urlLinks(fragment)).toEqual([`${ENV}->${MAP_URL}`]);
    const link = fragment.edges.find((entry) => entry.sourceId === ENV);
    expect(link?.knowledge.provenance).toBe('framework-convention');
    expect(link?.knowledge.evidenceIds).toContain('ev:ref:local._agg.newsletter');
  });

  it('links nothing when no map entry names the stem', async () => {
    const fragment = await enrich({
      callFacts: [mapEntryReference('local._agg.billing')],
    });
    expect(urlLinks(fragment)).toEqual([]);
  });

  it('links nothing when TWO maps both name the stem — ambiguity is not resolved by guessing', async () => {
    const otherBlock = 'terraform:infra/local.other_service_urls';
    const otherUrl = 'service-url:local.other_service_urls';
    const fragment = await enrich({
      nodes: [
        node(otherUrl, 'service-url', 'local.other_service_urls', INFRA),
        node(otherBlock, 'terraform-local', 'local.other_service_urls', INFRA),
      ],
      edges: [edge('RESOLVES_TO', otherUrl, otherBlock)],
      callFacts: [
        mapEntryReference('local._agg.newsletter'),
        mapEntryReference('local._other.newsletter', otherBlock),
      ],
    });
    expect(urlLinks(fragment)).toEqual([]);
  });

  it('never links an environment variable that is not URL-shaped', async () => {
    const fragment = await enrich({
      nodes: [node('env:NEWSLETTER_TOPIC', 'environment-variable', 'NEWSLETTER_TOPIC', 'a.ts')],
      callFacts: [mapEntryReference('local._agg.newsletter')],
    });
    expect(urlLinks(fragment)).toEqual([`${ENV}->${MAP_URL}`]);
  });
});
