import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { matchConcepts } from './concept-matching.js';

import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const CATEGORY_BY_TYPE: Record<string, string> = {
  'terraform-resource': 'infrastructure',
};

const node = (id: string, type: string, name: string, path?: string): GraphNode => {
  const category = CATEGORY_BY_TYPE[type] ?? 'repository';
  const result = createGraphNode({
    id,
    category,
    type,
    name,
    knowledge,
    ...(path === undefined ? {} : { path }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const graphOf = (nodes: readonly GraphNode[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, []);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

// Field report: `require_internal_auth` exists in several unrelated services, `_listing_ref` in an
// unrelated notification-service. Exact matches used to return every copy at full strength with no
// warning — five coincidences presented as five obligations. A collision across top-level
// containers is now marked, and past the MAX_SIMILAR_MATCHES bound it escalates to ambiguous,
// exactly like the fuzzy overflow it structurally is.
describe('matchConcepts exact-name collisions across containers', () => {
  const serviceSymbol = (service: string, name = 'require_internal_auth'): GraphNode =>
    node(`symbol:${service}`, 'symbol', name, `${service}/src/auth.py`);

  it('escalates to ambiguous when the exact name exists in more than three containers', () => {
    const graph = graphOf(
      ['auth-service', 'billing-service', 'notification-service', 'gdpr-service'].map((service) =>
        serviceSymbol(service),
      ),
    );

    const result = matchConcepts(graph, ['require_internal_auth']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['require_internal_auth']);
  });

  it('keeps 2-3 collisions but marks each match with the collision', () => {
    const graph = graphOf(
      ['auth-service', 'billing-service', 'notification-service'].map((service) =>
        serviceSymbol(service),
      ),
    );

    const result = matchConcepts(graph, ['require_internal_auth']);

    expect(result.matches).toHaveLength(3);
    for (const match of result.matches) {
      expect(match.collision).toEqual({
        count: 3,
        containers: ['auth-service', 'billing-service', 'notification-service'],
      });
      expect(match.ambiguous).toBe(true);
    }
    expect(result.ambiguousConcepts).toEqual([]);
  });

  it('leaves exact matches within a single container unmarked', () => {
    const graph = graphOf([
      node('symbol:a', 'symbol', 'require_internal_auth', 'auth-service/src/a.py'),
      node('symbol:b', 'symbol', 'require_internal_auth', 'auth-service/src/b.py'),
    ]);

    const result = matchConcepts(graph, ['require_internal_auth']);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.collision === undefined)).toBe(true);
  });

  it('leaves a path-qualified concept untouched however many containers share the name', () => {
    const graph = graphOf(
      ['auth-service', 'billing-service', 'notification-service', 'gdpr-service'].map((service) =>
        node(`file:${service}`, 'file', 'handlers.py', `${service}/src/handlers.py`),
      ),
    );

    const result = matchConcepts(graph, ['handlers.py']);

    expect(result.matches).toHaveLength(4);
    expect(result.matches.every((match) => match.collision === undefined)).toBe(true);
    expect(result.ambiguousConcepts).toEqual([]);
  });

  it('derives containers from declared package nodes in a monorepo', () => {
    const graph = graphOf([
      node('package:a', 'package', 'a', 'packages/a/package.json'),
      node('package:b', 'package', 'b', 'packages/b/package.json'),
      node('symbol:a', 'symbol', 'requireInternalAuth', 'packages/a/src/auth.ts'),
      node('symbol:b', 'symbol', 'requireInternalAuth', 'packages/b/src/auth.ts'),
    ]);

    const result = matchConcepts(graph, ['requireInternalAuth']);

    expect(result.matches).toHaveLength(2);
    for (const match of result.matches) {
      expect(match.collision).toEqual({ count: 2, containers: ['packages/a', 'packages/b'] });
    }
  });

  it("keeps today's behavior when containers cannot be told apart", () => {
    // Same monorepo, no package nodes indexed: both paths share the first segment, so the graph
    // cannot say the copies live in different containers — no collision is invented.
    const graph = graphOf([
      node('symbol:a', 'symbol', 'requireInternalAuth', 'packages/a/src/auth.ts'),
      node('symbol:b', 'symbol', 'requireInternalAuth', 'packages/b/src/auth.ts'),
    ]);

    const result = matchConcepts(graph, ['requireInternalAuth']);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.collision === undefined)).toBe(true);
  });

  it('never treats a cross-stack correspondence as a collision', () => {
    // PRD §C16: a package, and the Terraform resource that deploys it, DELIBERATELY share a name —
    // one logical component manifesting in two stacks, not two coincidences. Only same-category
    // nodes collide; different kinds of artifact sharing a name are how stacks correspond.
    const graph = graphOf([
      node('package:web', 'package', 'deals-web', 'web/package.json'),
      node(
        'terraform:web',
        'terraform-resource',
        'deals-web',
        'infra/google_cloud_run_v2_service.web.tf',
      ),
    ]);

    const result = matchConcepts(graph, ['deals-web']);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.collision === undefined)).toBe(true);
  });

  it('a correspondence partner does not shield a same-kind collision', () => {
    const graph = graphOf([
      ...['auth-service', 'billing-service', 'notification-service'].map((service) =>
        serviceSymbol(service, 'deals_web'),
      ),
      node('terraform:web', 'terraform-resource', 'deals-web', 'infra/web.tf'),
    ]);

    const result = matchConcepts(graph, ['deals-web']);
    const symbols = result.matches.filter((match) => match.nodeId.startsWith('symbol:'));
    const terraform = result.matches.find((match) => match.nodeId === 'terraform:web');

    expect(symbols).toHaveLength(3);
    expect(symbols.every((match) => match.collision !== undefined)).toBe(true);
    expect(terraform?.collision).toBeUndefined();
  });

  it('assesses the collision after test artifacts are dropped', () => {
    const graph = graphOf([
      node('symbol:prod', 'symbol', 'SecretStore', 'auth-service/src/registry.py'),
      node('symbol:double', 'symbol', 'SecretStore', 'gdpr-service/tests/test_gdpr.py'),
    ]);

    const result = matchConcepts(graph, ['SecretStore']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['symbol:prod']);
    expect(result.matches[0]?.collision).toBeUndefined();
  });
});
