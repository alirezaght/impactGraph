import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { matchConcepts } from './concept-matching.js';

import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Path-derived and speculative concept resolution (ADR-0021): directory segments, repository
// paths written in prose, and the strong-or-silent rule for mined concepts. Split from
// concept-matching.test.ts for the effective-LOC policy; the helpers are deliberately identical.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const CATEGORY_BY_TYPE: Record<string, string> = {
  service: 'application',
  package: 'repository',
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

describe('matchConcepts path segments', () => {
  // "How does admin reach the user-profile service?" was unanswerable because nothing was NAMED
  // user-profile-service — the service existed only as a directory. A concept equal to a path
  // segment resolves to that directory's files, so a plan naming a service can be checked against
  // the rules that govern it even in repositories without per-service manifests.
  const serviceGraph = graphOf([
    node(
      'file:routes',
      'file',
      'issue_routes.py',
      'services/newsletter-service/api/issue_routes.py',
    ),
    node('file:profile', 'file', 'app.py', 'services/user-profile-service/app.py'),
    node('file:profile-deep', 'file', 'models.py', 'services/user-profile-service/db/models.py'),
    node('file:other', 'file', 'send.py', 'services/newsletter-service/jobs/send.py'),
  ]);

  it('resolves a concept equal to a directory segment to the files under it', () => {
    const result = matchConcepts(serviceGraph, ['user-profile service']);

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.mechanism).toBe('path-segment');
    expect(result.matches.map((match) => match.nodeId)).toContain('file:profile');
    expect(result.unknownConcepts).toHaveLength(0);
  });

  it('prefers shallow files and stays bounded', () => {
    const many = graphOf([
      node('file:entry', 'file', 'app.py', 'services/billing-service/app.py'),
      ...Array.from({ length: 9 }, (_, index) =>
        node(
          `file:deep-${String(index)}`,
          'file',
          `handler${String(index)}.py`,
          `services/billing-service/handlers/deep/handler${String(index)}.py`,
        ),
      ),
    ]);

    const result = matchConcepts(many, ['billing-service']);

    expect(result.matches.length).toBeLessThanOrEqual(5);
    expect(result.matches[0]?.nodeId).toBe('file:entry');
    expect(result.matches.every((match) => match.ambiguous)).toBe(true);
  });

  it('never segment-matches a short generic word', () => {
    const result = matchConcepts(serviceGraph, ['api']);

    expect(result.matches).toHaveLength(0);
  });

  it('prefers a name match over a segment match', () => {
    const named = graphOf([
      node('run:newsletter', 'service', 'newsletter-service', 'infra/main.tf'),
      node('file:routes2', 'file', 'a.py', 'services/newsletter-service/a.py'),
    ]);

    const result = matchConcepts(named, ['newsletter-service']);

    expect(result.matches.map((match) => match.mechanism)).toEqual(['exact']);
  });
});

describe('matchConcepts path-shaped concepts', () => {
  const repoGraph = graphOf([
    node('file:domain-index', 'file', 'index.ts', 'packages/domain/src/index.ts'),
    node('file:domain-deep', 'file', 'evidence.ts', 'packages/domain/src/provenance/evidence.ts'),
    node('file:app-index', 'file', 'index.ts', 'packages/application/src/index.ts'),
  ]);

  it('resolves a directory path the specification wrote to the files under it', () => {
    const result = matchConcepts(repoGraph, ['packages/domain']);

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.mechanism).toBe('path-segment');
    expect(result.matches.map((match) => match.nodeId)).toContain('file:domain-index');
    expect(result.matches.map((match) => match.nodeId)).not.toContain('file:app-index');
  });

  it('resolves an exact file path at exact grade', () => {
    const result = matchConcepts(repoGraph, ['packages/domain/src/index.ts']);

    expect(result.matches.map((match) => match.mechanism)).toEqual(['exact']);
    expect(result.matches[0]?.nodeId).toBe('file:domain-index');
  });

  // "Required must mean strong": a specification writes paths relative to the package it
  // discusses. A UNIQUE path-boundary suffix is the same claim as a verbatim path — exact-grade,
  // never an unresolved concept — while a suffix matching several places is a question.
  it('resolves a service-relative path by unique path-boundary suffix', () => {
    const result = matchConcepts(repoGraph, ['src/provenance/evidence.ts']);

    expect(result.matches.map((match) => match.mechanism)).toEqual(['path-suffix']);
    expect(result.matches[0]?.nodeId).toBe('file:domain-deep');
    expect(result.matches[0]?.ambiguous).toBe(false);
    expect(result.unknownConcepts).toEqual([]);
  });

  it('routes a suffix matching several places to the ambiguous path with the candidates', () => {
    const result = matchConcepts(repoGraph, ['src/index.ts']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['src/index.ts']);
    expect(result.unknownConcepts).toEqual([]);
    expect(result.pathCandidates.get('src/index.ts')).toEqual([
      'packages/application/src/index.ts',
      'packages/domain/src/index.ts',
    ]);
  });
});

describe('matchConcepts bare filenames', () => {
  // A bare generic filename is not identifier-grade: `specification.ts` exists in many packages,
  // and the specification did not say which one. Two or more files with the basename make the
  // concept ambiguous; even a unique basename match stays a name-level guess.
  it('escalates a bare filename that exists in several places to an ambiguous concept', () => {
    const graph = graphOf([
      node('file:spec-a', 'file', 'specification.ts', 'packages/domain/src/specification.ts'),
      node('file:spec-b', 'file', 'specification.ts', 'packages/contracts/src/specification.ts'),
    ]);

    const result = matchConcepts(graph, ['specification.ts']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual(['specification.ts']);
  });

  it('demotes a unique basename match to the basename mechanism', () => {
    const graph = graphOf([
      node('file:spec', 'file', 'specification.ts', 'packages/domain/src/specification.ts'),
    ]);

    const result = matchConcepts(graph, ['specification.ts']);

    expect(result.matches.map((match) => match.mechanism)).toEqual(['basename']);
    expect(result.matches[0]?.nodeId).toBe('file:spec');
  });

  it('keeps a root file the specification named by its full path at exact grade', () => {
    const graph = graphOf([node('file:root', 'file', 'vitest.config.ts', 'vitest.config.ts')]);

    const result = matchConcepts(graph, ['vitest.config.ts']);

    expect(result.matches.map((match) => match.mechanism)).toEqual(['exact']);
  });
});

describe('matchConcepts speculative concepts', () => {
  it('never lets a mined kebab word resolve by fuzzy name similarity', () => {
    // 'mcp-server' (mined from "apps/mcp-server" prose) once similarity-matched every server.ts
    // in the repository including test fixtures — 200 lead-tier impacts from one phrase. A mined
    // concept must resolve strongly (exact name, directory segment) or not at all.
    const graph = graphOf([
      node('file:server', 'file', 'server.ts', 'apps/mcp-server/src/server.ts'),
      node('file:fixture-server', 'file', 'server.ts', 'fixtures/express-app/src/server.ts'),
    ]);

    const kebab = matchConcepts(graph, ['mcp-server']);
    expect(kebab.matches.every((match) => match.mechanism !== 'name-similarity')).toBe(true);
    expect(kebab.matches.map((match) => match.nodeId)).toEqual(['file:server']);
  });

  it('drops a mined phrase that only spreads fuzzily — silently, without an ambiguity question', () => {
    const graph = graphOf([
      node('symbol:b', 'symbol', 'IndexStorePort', 'b/b.ts'),
      node('symbol:c', 'symbol', 'IndexStoreView', 'c/c.ts'),
    ]);

    const result = matchConcepts(graph, ['index store']);

    expect(result.matches).toEqual([]);
    expect(result.ambiguousConcepts).toEqual([]);
    expect(result.unknownConcepts).toEqual(['index store']);
  });
});
