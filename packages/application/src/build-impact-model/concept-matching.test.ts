import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
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
  test: 'application',
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

  it('does not match a concept that is only a fragment of a longer identifier', () => {
    const result = matchConcepts(languageGraph, ['TypeScript']);

    expect(result.matches).toEqual([]);
    expect(result.unknownConcepts).toEqual(['TypeScript']);
  });

  // A token ratio accepted this pair (2 of 3 tokens) because "TypeScript" splits on its hump
  // while the kebab-cased spelling of the same word does not.
  it('treats a word the same however it is cased', () => {
    const graph = graphOf([
      node('symbol:iface', 'symbol', 'TypeScriptAdapter', 'packages/language-adapters/src/x.ts'),
      node('file:kebab', 'file', 'typescript-adapter.ts', 'packages/language-adapters/src/y.ts'),
    ]);

    expect(matchConcepts(graph, ['TypeScript']).matches).toEqual([]);
    expect(matchConcepts(graph, ['typescript']).matches).toEqual([]);
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
    const graph = graphOf([
      node('file:a', 'file', 'index-store.ts', 'a/index-store.ts'),
      node('symbol:b', 'symbol', 'IndexStorePort', 'b/b.ts'),
      node('symbol:c', 'symbol', 'IndexStoreView', 'c/c.ts'),
      node('symbol:d', 'symbol', 'IndexStoreImpl', 'd/d.ts'),
      node('symbol:e', 'symbol', 'IndexStoreBase', 'e/e.ts'),
    ]);

    const result = matchConcepts(graph, ['index store']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['index store']);
  });
});

describe('matchConcepts and ubiquitous dependencies', () => {
  const workspaceOf = (declarers: number, totalPackages: number): KnowledgeGraph => {
    const nodes: GraphNode[] = [node('dependency:typescript', 'third-party-service', 'typescript')];
    const edges = [];
    for (let index = 0; index < totalPackages; index += 1) {
      nodes.push(node(`package:p${String(index)}`, 'package', `p${String(index)}`));
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
