import { describe, expect, it } from 'vitest';

import { createCrossStackAdapter } from './cross-stack-adapter.js';
import { normalizeRoutePath } from './route-index.js';

import type { CodeGraph } from '../types.js';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CallFact, GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Story 16.6 — the NEGATIVE space. The happy path is pinned by the full-pipeline golden
// (`packages/test-kit/goldens/cross-stack.graph.txt`); what needs its own tests is everything this
// adapter must REFUSE to correlate, because a plausible-looking wrong edge is the failure mode
// that matters here (language-adapter skill: name-similarity edges are a violation).

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-cross',
  analysisRunId: 'run-cross',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const knowledge = {
  provenance: 'framework-convention' as const,
  evidenceIds: ['ev:test'] as readonly string[],
  confidence: { value: 1, signals: [] },
  createdAt: CONTEXT.createdAt,
  repositorySnapshotId: CONTEXT.repositorySnapshotId,
  analysisRunId: CONTEXT.analysisRunId,
};

/**
 * An `api-endpoint` node carries its §12.1.1 route contract, because that is now what states its
 * verb and path. A route node without one states no route at all — matching reads the contract and
 * never the display name.
 */
const node = (id: string, type: string, name: string, path?: string): GraphNode => {
  const space = name.indexOf(' ');
  const route =
    type === 'api-endpoint' && space > 0
      ? {
          method: name.slice(0, space),
          path: name.slice(space + 1),
          pathParameters: [],
          queryParameters: [],
        }
      : undefined;
  return {
    id,
    category: 'application',
    type,
    name,
    path,
    route,
    knowledge,
  } as unknown as GraphNode;
};

const templateFact = (
  calleeName: string,
  value: string,
  filePath = 'src/pages/index.astro',
): CallFact => ({
  filePath,
  receiverName: 'astro:template',
  calleeName,
  stringArguments: [value],
  identifierArguments: [],
  evidenceId: `ev:template:${calleeName}:${value}`,
});

const graphOf = (nodes: readonly GraphNode[], callFacts: readonly CallFact[] = []): CodeGraph => ({
  nodes,
  edges: [] as readonly GraphEdge[],
  decorators: [],
  callFacts,
  symbolReferences: [],
  resolveSymbol: () => undefined,
  importsOf: () => [],
});

const enrich = (graph: CodeGraph): Promise<GraphFragment> =>
  createCrossStackAdapter().enrich(graph, {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });

const edgeIds = (fragment: GraphFragment): string[] =>
  fragment.edges.map((edge) => `${edge.type}|${edge.sourceId}->${edge.targetId}`);

describe('cross-stack adapter — what it refuses to correlate (PRD §C13)', () => {
  it('matches a form action to every verb declared at that exact path', async () => {
    const fragment = await enrich(
      graphOf(
        [
          node('route:GET /api/deals', 'api-endpoint', 'GET /api/deals'),
          node('route:POST /api/deals', 'api-endpoint', 'POST /api/deals'),
          node(
            'symbol:src/pages/index.astro#index',
            'ui-component',
            'index',
            'src/pages/index.astro',
          ),
        ],
        [templateFact('form.action', '/api/deals')],
      ),
    );
    // A `<form action>` with no stated method names a path and not a verb, so both declared verbs
    // are legitimate correspondences — and both are submissions (§12.2.1).
    expect(edgeIds(fragment).sort()).toEqual([
      'SUBMITS_TO|symbol:src/pages/index.astro#index->route:GET /api/deals',
      'SUBMITS_TO|symbol:src/pages/index.astro#index->route:POST /api/deals',
    ]);
  });

  it('never matches a near miss, an external URL, or a non-endpoint attribute', async () => {
    const fragment = await enrich(
      graphOf(
        [node('route:GET /api/deals', 'api-endpoint', 'GET /api/deals')],
        [
          templateFact('a.href', '/api/deal'), // one character off
          templateFact('a.href', '/api/deals/1'), // a longer path, not a prefix match
          templateFact('a.href', 'https://example.com/api/deals'), // another origin
          templateFact('a.href', '//cdn.example.com/api/deals'), // protocol-relative
          templateFact('a.href', 'api/deals'), // relative, resolves against an unknown base
          templateFact('a.href', '#api/deals'), // an anchor
          templateFact('img.src', '/api/deals'), // an asset reference, not a call
          templateFact('script.src', '/api/deals'),
        ],
      ),
    );
    expect(fragment.edges).toEqual([]);
  });

  // Story 16.6 last open task — a `fetch('<literal>')` in a .ts file is the same kind of URL
  // reference as an Astro attribute, and is held to exactly the same exactness rules.
  it('matches a TypeScript fetch URL and attributes it to the declaration that made the call', async () => {
    const fetchFact = (url: string, enclosingSymbolNodeId?: string): CallFact => ({
      filePath: 'src/lib/api.ts',
      receiverName: 'http:client',
      calleeName: 'fetch',
      stringArguments: [url],
      identifierArguments: [],
      ...(enclosingSymbolNodeId === undefined ? {} : { enclosingSymbolNodeId }),
      evidenceId: `ev:fetch:${url}`,
    });
    const fragment = await enrich(
      graphOf(
        [
          node('route:GET /api/deals', 'api-endpoint', 'GET /api/deals'),
          node('symbol:src/lib/api.ts#loadDeals', 'function', 'loadDeals', 'src/lib/api.ts'),
        ],
        [
          fetchFact('/api/deals', 'symbol:src/lib/api.ts#loadDeals'),
          fetchFact('/api/deal', 'symbol:src/lib/api.ts#loadDeals'), // near miss
          fetchFact('https://example.com/api/deals'), // another origin
          // An enclosing id the graph does not know must never become a dangling edge source.
          fetchFact('/api/deals', 'symbol:src/lib/api.ts#neverDeclared'),
        ],
      ),
    );
    expect(edgeIds(fragment).sort()).toEqual([
      'CALLS_ENDPOINT|file:src/lib/api.ts->route:GET /api/deals',
      'CALLS_ENDPOINT|symbol:src/lib/api.ts#loadDeals->route:GET /api/deals',
    ]);
  });

  it('attaches evidence from both sides of a route correspondence', async () => {
    const fragment = await enrich(
      graphOf(
        [node('route:GET /api/deals', 'api-endpoint', 'GET /api/deals')],
        [templateFact('a.href', '/api/deals')],
      ),
    );
    const edge = fragment.edges[0];
    expect(edge?.knowledge.provenance).toBe('framework-convention');
    expect(edge?.knowledge.evidenceIds).toEqual(['ev:template:a.href:/api/deals', 'ev:test']);
  });

  it('normalizes only query, fragment and trailing slash — never the path itself', () => {
    expect(normalizeRoutePath('/api/deals/')).toBe('/api/deals');
    expect(normalizeRoutePath('/api/deals?page=2')).toBe('/api/deals');
    expect(normalizeRoutePath('/api/deals#top')).toBe('/api/deals');
    expect(normalizeRoutePath('/')).toBe('/');
    expect(normalizeRoutePath('/API/Deals')).toBe('/API/Deals'); // no case folding
    expect(normalizeRoutePath('mailto:a@b.c')).toBeUndefined();
    expect(normalizeRoutePath('javascript:alert(1)')).toBeUndefined();
  });

  it('correlates infrastructure only on an exact declared name and a matching kind', async () => {
    const fragment = await enrich(
      graphOf([
        node('package:deals-web', 'package', 'deals-web'),
        node('topic:deal-events', 'topic', 'deal-events'),
        // Exact name, right kind → correlated.
        node('terraform:infra/google_cloud_run_v2_service.web', 'cloud-run-service', 'deals-web'),
        node('terraform:infra/google_pubsub_topic.e', 'pubsub-topic', 'deal-events'),
        // Right name, WRONG kind: a topic is not a deployment target for a package.
        node('terraform:infra/google_pubsub_topic.w', 'pubsub-topic', 'deals-web'),
        // Near miss.
        node('terraform:infra/google_cloud_run_v2_service.x', 'cloud-run-service', 'deals-we'),
      ]),
    );
    expect(edgeIds(fragment).sort()).toEqual([
      'DEPLOYED_AS|package:deals-web->terraform:infra/google_cloud_run_v2_service.web',
      'DEPLOYED_AS|topic:deal-events->terraform:infra/google_pubsub_topic.e',
    ]);
  });

  // Story 16.3 — the code-side `topic:` / `subscription:` nodes now come from real Pub/Sub client
  // usage as well as from NestJS and §Z8 rules. This adapter must not care which produced them,
  // and must apply the same exactness to a subscription as it does to a topic.
  it('correlates a subscription on an exact declared name, and refuses the near miss', async () => {
    const fragment = await enrich(
      graphOf([
        node('subscription:deal-events-worker', 'subscription', 'deal-events-worker'),
        node('subscription:deal-events-worker-2', 'subscription', 'deal-events-worker-2'),
        node('topic:deal-event', 'topic', 'deal-event'), // one character off — never matched
        node(
          'terraform:infra/google_pubsub_subscription.w',
          'pubsub-subscription',
          'deal-events-worker',
        ),
        node('terraform:infra/google_pubsub_topic.e', 'pubsub-topic', 'deal-events'),
        // Right name, WRONG kind: a subscription is not a topic.
        node('terraform:infra/google_pubsub_topic.w', 'pubsub-topic', 'deal-events-worker'),
      ]),
    );
    expect(edgeIds(fragment).sort()).toEqual([
      'DEPLOYED_AS|subscription:deal-events-worker->terraform:infra/google_pubsub_subscription.w',
    ]);
  });

  it('stops warning once a code-side publisher or consumer was actually detected', async () => {
    const fragment = await enrich(
      graphOf([
        node('topic:deal-events', 'topic', 'deal-events'),
        node('terraform:infra/google_pubsub_topic.e', 'pubsub-topic', 'deal-events'),
      ]),
    );
    expect(fragment.warnings).toEqual([]);
  });

  it('never correlates a resource whose declared name could not be resolved', async () => {
    // The Terraform adapter falls back to the address when `name` interpolates. That fallback name
    // is the id's tail, which is how this adapter knows the configuration never stated a name.
    const fragment = await enrich(
      graphOf([
        node('topic:google_pubsub_topic.dead_letter', 'topic', 'google_pubsub_topic.dead_letter'),
        node(
          'terraform:modules/dl/google_pubsub_topic.dead_letter',
          'pubsub-topic',
          'google_pubsub_topic.dead_letter',
        ),
      ]),
    );
    expect(fragment.edges).toEqual([]);
  });

  it('reports an uncorrelated Pub/Sub resource instead of silently emitting nothing', async () => {
    const fragment = await enrich(
      graphOf([
        node('package:api', 'package', 'api'),
        node('terraform:infra/google_pubsub_topic.e', 'pubsub-topic', 'deal-events'),
      ]),
    );
    const message = fragment.warnings.map((warning) => warning.message).join(' ');
    // Names the shapes that ARE covered, so "detected nothing" cannot be read as "not built".
    expect(message).toContain('no code-side publisher or consumer was detected');
    expect(message).toContain('@google-cloud/pubsub');
    expect(message).toContain('google.cloud.pubsub_v1');
  });

  it('does not detect when only one stack is present', async () => {
    const detection = await createCrossStackAdapter().detect(
      graphOf([node('route:GET /api/deals', 'api-endpoint', 'GET /api/deals')]),
    );
    expect(detection.detected).toBe(false);
    expect(detection.reason).toBe('no two stacks with correlatable facts found');
  });
});
