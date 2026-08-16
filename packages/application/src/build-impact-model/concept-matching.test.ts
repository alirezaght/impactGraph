import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { classifyCandidate } from './classification.js';
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
  test: 'application',
  controller: 'application',
  service: 'application',
  module: 'application',
  'third-party-service': 'integration',
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

describe('matchConcepts token alignment', () => {
  // The word "TypeScript" in "exclude TypeScript sources" used to substring-match every node
  // whose name merely contained it, seeding a 102-impact traversal from one requirement.
  const languageGraph = graphOf([
    node(
      'file:adapter',
      'file',
      'typescript-adapter.ts',
      'packages/language-adapters/src/typescript/typescript-adapter.ts',
    ),
    node('file:adr', 'file', '0003-typescript-primary-language.md', 'docs/adr/0003.md'),
    node(
      'symbol:parse',
      'symbol',
      'parseTypeScriptFile',
      'packages/language-adapters/src/typescript/parse-source.ts',
    ),
  ]);

  // Pre-ADR-0016, 'TypeScript' seeded 102 impacts by substring-matching every node containing
  // it. The stem rule stays bounded: only the adapter file — whose whole stem IS the concept —
  // resolves, and it resolves at name-similarity, which the basis ceiling caps at `likely`.
  // Fragment containment (`parseTypeScriptFile`, the ADR document) is still rejected.
  it('matches only the node whose whole stem is the concept, never mere fragments', () => {
    const result = matchConcepts(languageGraph, ['TypeScript']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['file:adapter']);
    expect(result.matches[0]?.mechanism).toBe('name-similarity');
    expect(result.unknownConcepts).toEqual([]);
  });

  // A token ratio accepted camel and rejected kebab (2 of 3 tokens) because "TypeScript" splits
  // on its hump while the kebab-cased spelling does not. The stem rule compares characters, so
  // both spellings of the same word behave identically — both resolve, at name-similarity.
  it('treats a word the same however it is cased', () => {
    const graph = graphOf([
      node('symbol:iface', 'symbol', 'TypeScriptAdapter', 'packages/language-adapters/src/x.ts'),
      node('file:kebab', 'file', 'typescript-adapter.ts', 'packages/language-adapters/src/y.ts'),
    ]);

    for (const concept of ['TypeScript', 'typescript']) {
      const result = matchConcepts(graph, [concept]);
      expect(result.matches.map((match) => match.nodeId).sort()).toEqual([
        'file:kebab',
        'symbol:iface',
      ]);
      expect(result.matches.every((match) => match.mechanism === 'name-similarity')).toBe(true);
    }
  });

  it('still matches when the concept covers most of the node name', () => {
    const graph = graphOf([
      node('symbol:run', 'symbol', 'runConfigureModelProvider', 'src/commands/provider-config.ts'),
    ]);

    const result = matchConcepts(graph, ['configureModelProvider']);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.nodeId).toBe('symbol:run');
    expect(result.matches[0]?.mechanism).toBe('name-similarity');
  });

  it('keeps exact name matches unaffected', () => {
    const graph = graphOf([
      node(
        'symbol:open',
        'symbol',
        'openSqliteIndexStore',
        'packages/persistence/src/index/sqlite-index-store.ts',
      ),
    ]);

    const result = matchConcepts(graph, ['openSqliteIndexStore']);

    expect(result.matches[0]?.mechanism).toBe('exact');
    expect(result.matches[0]?.nodeId).toBe('symbol:open');
  });

  it('reports a weak concept that spreads across many nodes as ambiguous, not as matches', () => {
    // An ASSERTED identifier (the author wrote it) that fuzzes too widely earns a clarification
    // question; a mined phrase in the same situation is silently not a concept (see the
    // speculative-concepts suite below).
    const graph = graphOf([
      node('file:a', 'file', 'index-store.ts', 'a/index-store.ts'),
      node('symbol:b', 'symbol', 'IndexStorePort', 'b/b.ts'),
      node('symbol:c', 'symbol', 'IndexStoreView', 'c/c.ts'),
      node('symbol:d', 'symbol', 'IndexStoreImpl', 'd/d.ts'),
      node('symbol:e', 'symbol', 'IndexStoreBase', 'e/e.ts'),
    ]);

    const result = matchConcepts(graph, ['IndexStore']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['IndexStore']);
  });
});

describe('matchConcepts route-path identity (§12.1.1)', () => {
  const routeNode = (id: string, method: string, path: string): GraphNode => {
    const result = createGraphNode({
      id,
      category: 'application',
      type: 'api-endpoint',
      name: `${method} ${path}`,
      route: { path, method, pathParameters: [], queryParameters: [] },
      knowledge,
    });
    if (!result.ok) {
      throw new Error(`route node ${id}`);
    }
    return result.value;
  };
  const routes = graphOf([
    routeNode('route:GET /api/deals', 'GET', '/api/deals'),
    routeNode('route:POST /api/deals', 'POST', '/api/deals'),
  ]);

  it('treats a concept naming a declared route path as an exact match on every verb', () => {
    // A path is an identifier the specification can name (§12.1.1: a path moving obliges every
    // verb served at it) — NOT a fuzzy resemblance to the display name 'GET /api/deals'.
    const result = matchConcepts(routes, ['/api/deals']);
    expect(result.matches.map((match) => match.nodeId).sort()).toEqual([
      'route:GET /api/deals',
      'route:POST /api/deals',
    ]);
    expect(result.matches.every((match) => match.mechanism === 'exact')).toBe(true);
  });

  it('a verb-qualified concept still resolves to the single route by display name', () => {
    const result = matchConcepts(routes, ['GET /api/deals']);
    expect(result.matches.map((match) => match.nodeId)).toEqual(['route:GET /api/deals']);
    expect(result.matches[0]?.mechanism).toBe('exact');
  });
});

describe('matchConcepts and ubiquitous dependencies', () => {
  const workspaceOf = (declarers: number, totalPackages: number): KnowledgeGraph => {
    const nodes: GraphNode[] = [node('dependency:typescript', 'third-party-service', 'typescript')];
    const edges = [];
    for (let index = 0; index < totalPackages; index += 1) {
      nodes.push(
        node(
          `package:p${String(index)}`,
          'package',
          `p${String(index)}`,
          `packages/p${String(index)}/package.json`,
        ),
      );
      if (index < declarers) {
        const edge = createGraphEdge({
          id: `depends-on:package:p${String(index)}->dependency:typescript`,
          type: 'DEPENDS_ON',
          sourceId: `package:p${String(index)}`,
          targetId: 'dependency:typescript',
          knowledge,
        });
        if (!edge.ok) {
          throw new Error('edge invalid');
        }
        edges.push(edge.value);
      }
    }
    const result = createKnowledgeGraph(nodes, edges);
    if (!result.ok) {
      throw new Error('graph invalid');
    }
    return result.value;
  };

  // "exclude TypeScript sources" is about build output, but the word exact-matches the compiler
  // every package declares — anchoring there predicts the whole monorepo, which narrows nothing.
  it('refuses to anchor on a dependency most of the workspace declares', () => {
    const result = matchConcepts(workspaceOf(7, 8), ['typescript']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['typescript']);
  });

  it('still anchors on a dependency only a few packages declare', () => {
    const result = matchConcepts(workspaceOf(2, 8), ['typescript']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['dependency:typescript']);
  });

  // A single-package repository declares every dependency in 100% of its packages, so a bare
  // share threshold makes every dependency un-anchorable there — which is most repositories.
  it('anchors dependencies in a single-package repository', () => {
    const result = matchConcepts(workspaceOf(1, 1), ['typescript']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['dependency:typescript']);
  });

  it('needs a meaningful number of declarers before ubiquity applies', () => {
    const result = matchConcepts(workspaceOf(2, 3), ['typescript']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['dependency:typescript']);
  });
});

describe('matchConcepts architectural stem coverage (ADR-0016)', () => {
  // The dogfooding item-5 case: the specification says "deals", the repository says
  // `DealsController`. Character coverage alone rejects the pair (0.33); the convention-aware
  // rule accepts it — as `name-similarity`, so the basis ceiling holds it at `likely`.
  it('resolves a concept to a conventionally-suffixed component at name-similarity', () => {
    const graph = graphOf([
      node('symbol:ctrl', 'controller', 'DealsController', 'src/deals/deals.controller.ts'),
    ]);

    const result = matchConcepts(graph, ['deals']);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.nodeId).toBe('symbol:ctrl');
    expect(result.matches[0]?.mechanism).toBe('name-similarity');
  });

  it('still rejects a concept that covers only the suffix of a compound name', () => {
    const graph = graphOf([
      node('symbol:secret', 'symbol', 'SecretStorage', 'src/secret-storage.ts'),
      node('symbol:dto', 'symbol', 'DealDto', 'src/deal.dto.ts'),
      node('symbol:events', 'service', 'DealEventsService', 'src/deal-events.service.ts'),
    ]);

    // `Storage` covers no stem (nothing stripped); `Dto`/`service` ARE the suffix and add no
    // stem token. All three stay unknown — the rule is "be the stem", not "share a token".
    expect(matchConcepts(graph, ['Storage']).unknownConcepts).toEqual(['Storage']);
    expect(matchConcepts(graph, ['Dto']).unknownConcepts).toEqual(['Dto']);
    expect(matchConcepts(graph, ['service']).unknownConcepts).toEqual(['service']);
  });

  it('matches every conventional variant within the bound, marked ambiguous', () => {
    const graph = graphOf([
      node('symbol:ctrl', 'controller', 'DealsController', 'src/deals/deals.controller.ts'),
      node('symbol:svc', 'service', 'DealsService', 'src/deals/deals.service.ts'),
      node('symbol:mod', 'module', 'DealsModule', 'src/deals/deals.module.ts'),
    ]);

    const result = matchConcepts(graph, ['deals']);

    expect(result.matches.map((match) => match.nodeId).sort()).toEqual([
      'symbol:ctrl',
      'symbol:mod',
      'symbol:svc',
    ]);
    expect(result.matches.every((match) => match.ambiguous)).toBe(true);
  });

  it('escalates to ambiguous when too many components share the stem', () => {
    const graph = graphOf([
      node('symbol:ctrl', 'controller', 'DealsController', 'src/a.ts'),
      node('symbol:svc', 'service', 'DealsService', 'src/b.ts'),
      node('symbol:mod', 'module', 'DealsModule', 'src/c.ts'),
      node('symbol:repo', 'symbol', 'DealsRepository', 'src/d.ts'),
    ]);

    const result = matchConcepts(graph, ['deals']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['deals']);
  });

  it('an exact match still short-circuits stem coverage', () => {
    const graph = graphOf([
      node('symbol:exact', 'symbol', 'Deals', 'src/deals.ts'),
      node('symbol:ctrl', 'controller', 'DealsController', 'src/deals.controller.ts'),
    ]);

    const result = matchConcepts(graph, ['deals']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['symbol:exact']);
    expect(result.matches[0]?.mechanism).toBe('exact');
  });

  // The safety valve this rule depends on (ADR-0016): a stem-covered anchor can NEVER claim
  // `required` — the name-similarity basis caps it at `likely`, auditable via tierCappedBy.
  it('classifies a stem-covered anchor at likely, capped by the name-similarity basis', () => {
    const graph = graphOf([
      node('symbol:ctrl', 'controller', 'DealsController', 'src/deals/deals.controller.ts'),
    ]);
    const match = matchConcepts(graph, ['deals']).matches[0];
    expect(match).toBeDefined();
    if (match === undefined) {
      return;
    }
    const ctrl = graph.nodes.get('symbol:ctrl' as Parameters<typeof graph.nodes.get>[0]);
    expect(ctrl).toBeDefined();
    if (ctrl === undefined) {
      return;
    }

    const classified = classifyCandidate(
      {
        nodeId: match.nodeId,
        distance: 0,
        dependencyPath: [match.nodeId],
        edgeTypes: [],
        corroboratingEdgeTypes: [],
        admissible: true,
        weakLinkOnly: false,
        edgeEvidenceIds: [],
        structuralDepth: 0,
        chainHops: 0,
        anchorConcepts: [match.concept],
        propagationCorroborated: false,
        match,
      },
      ctrl,
      'REQ-1',
    );

    expect(classified.ok).toBe(true);
    if (!classified.ok) {
      return;
    }
    expect(classified.value.likelihood).toBe('likely');
    expect(classified.value.tierCappedBy).toBe('name-similarity');
    expect(classified.value.evidenceTypes).toEqual(['name-similarity']);
  });
});

describe('matchConcepts production-before-test ranking', () => {
  it('drops test artifacts when the concept also matches production code', () => {
    const graph = graphOf([
      node('symbol:prod', 'symbol', 'SecretStore', 'packages/ai-inference/src/registry.ts'),
      node('symbol:double', 'symbol', 'SecretStore', 'apps/ext/src/test/suite/secrets.ts'),
    ]);

    const result = matchConcepts(graph, ['SecretStore']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['symbol:prod']);
    expect(result.matches[0]?.testOnly).toBe(false);
  });

  it('flags a match that resolved only to a test artifact', () => {
    const graph = graphOf([
      node('symbol:double', 'symbol', 'SecretStorageLike', 'apps/ext/src/test/suite/secrets.ts'),
    ]);

    const result = matchConcepts(graph, ['SecretStorage']);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.testOnly).toBe(true);
  });

  it('recognises .test.ts files as test artifacts', () => {
    const graph = graphOf([
      node('symbol:prod', 'symbol', 'IndexStore', 'packages/persistence/src/store.ts'),
      node('symbol:spec', 'symbol', 'IndexStore', 'packages/persistence/src/store.test.ts'),
    ]);

    const result = matchConcepts(graph, ['IndexStore']);

    expect(result.matches.map((match) => match.nodeId)).toEqual(['symbol:prod']);
  });
});
