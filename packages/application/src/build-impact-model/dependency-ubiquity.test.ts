import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { assessUbiquity } from './dependency-ubiquity.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeId } from '@impactgraph/domain';

const knowledge = {
  provenance: 'configuration',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const pkg = (name: string, manifestPath: string): GraphNode => {
  const result = createGraphNode({
    id: `package:${name}`,
    category: 'repository',
    type: 'package',
    name,
    path: manifestPath,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`package ${name}`);
  }
  return result.value;
};

const dependency = (name: string): GraphNode => {
  const result = createGraphNode({
    id: `dependency:${name}`,
    category: 'integration',
    type: 'third-party-service',
    name,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`dependency ${name}`);
  }
  return result.value;
};

const declares = (packageName: string, dependencyName: string): GraphEdge => {
  const result = createGraphEdge({
    id: `depends-on:package:${packageName}->dependency:${dependencyName}`,
    type: 'DEPENDS_ON',
    sourceId: `package:${packageName}`,
    targetId: `dependency:${dependencyName}`,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`edge ${packageName}`);
  }
  return result.value;
};

const graphOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const assess = (graph: KnowledgeGraph, dependencyName: string) => {
  const node = graph.nodes.get(`dependency:${dependencyName}` as NodeId);
  if (node === undefined) {
    throw new Error('missing dependency node');
  }
  return assessUbiquity(graph, node);
};

describe('assessUbiquity — the eligible denominator', () => {
  it('counts only packages of the dependency’s own ecosystem', () => {
    // Four npm packages all declaring the dependency, beside twenty unrelated Java packages.
    // Diluting by the Java packages would read 4/24 and wrongly call this a rare dependency.
    const nodes: GraphNode[] = [dependency('eslint')];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 4; index += 1) {
      nodes.push(pkg(`ts-${String(index)}`, `apps/ts-${String(index)}/package.json`));
      edges.push(declares(`ts-${String(index)}`, 'eslint'));
    }
    for (let index = 0; index < 20; index += 1) {
      nodes.push(pkg(`java-${String(index)}`, `services/java-${String(index)}/pom.xml`));
    }

    const result = assess(graphOf(nodes, edges), 'eslint');

    expect(result.eligible).toBe(4);
    expect(result.declarers).toBe(4);
    expect(result.ubiquitous).toBe(true);
  });

  it('leaves a lone npm package in a mixed repository anchorable', () => {
    const graph = graphOf(
      [
        dependency('express'),
        pkg('web', 'web/package.json'),
        pkg('service', 'service/pom.xml'),
        pkg('jobs', 'jobs/pyproject.toml'),
      ],
      [declares('web', 'express')],
    );

    const result = assess(graph, 'express');

    expect(result.eligible).toBe(1);
    expect(result.ubiquitous).toBe(false);
    expect(result.reason).toBe('below-declarer-floor');
  });

  it('does not call three of four packages ubiquitous — the floor still applies', () => {
    const nodes: GraphNode[] = [dependency('vitest')];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 4; index += 1) {
      nodes.push(pkg(`p-${String(index)}`, `packages/p-${String(index)}/package.json`));
      if (index < 3) {
        edges.push(declares(`p-${String(index)}`, 'vitest'));
      }
    }

    const result = assess(graphOf(nodes, edges), 'vitest');

    expect(result.declarers).toBe(3);
    expect(result.eligible).toBe(4);
    // 0.75 share, but refusing to anchor is the destructive move and three declarers in a
    // four-package workspace is not evidence of shared tooling.
    expect(result.ubiquitous).toBe(false);
    expect(result.reason).toBe('below-declarer-floor');
  });

  it('excludes packages vendored inside another package from the denominator', () => {
    // Test fixtures and vendored examples are not peers of the workspace they sit in. Counting
    // them dilutes the share: here five real packages all declare it, beside ten nested fixtures.
    const nodes: GraphNode[] = [dependency('typescript'), pkg('kit', 'packages/kit/package.json')];
    const edges: GraphEdge[] = [declares('kit', 'typescript')];
    for (let index = 0; index < 4; index += 1) {
      nodes.push(pkg(`real-${String(index)}`, `packages/real-${String(index)}/package.json`));
      edges.push(declares(`real-${String(index)}`, 'typescript'));
    }
    for (let index = 0; index < 10; index += 1) {
      nodes.push(
        pkg(`fixture-${String(index)}`, `packages/kit/fixtures/f${String(index)}/package.json`),
      );
    }

    const result = assess(graphOf(nodes, edges), 'typescript');

    expect(result.eligible).toBe(5);
    expect(result.declarers).toBe(5);
    expect(result.ubiquitous).toBe(true);
  });

  it('keeps the repository root in the denominator, since everything nests under it', () => {
    const graph = graphOf(
      [dependency('zod'), pkg('root', 'package.json'), pkg('core', 'packages/core/package.json')],
      [declares('root', 'zod')],
    );

    const result = assess(graph, 'zod');

    expect(result.eligible).toBe(2);
  });

  it('treats a dependency declared only at the root as rare, not ubiquitous', () => {
    const nodes: GraphNode[] = [dependency('husky'), pkg('root', 'package.json')];
    for (let index = 0; index < 8; index += 1) {
      nodes.push(pkg(`m-${String(index)}`, `packages/m-${String(index)}/package.json`));
    }

    const result = assess(graphOf(nodes, [declares('root', 'husky')]), 'husky');

    expect(result.declarers).toBe(1);
    expect(result.ubiquitous).toBe(false);
  });

  it('never suppresses a dependency whose ecosystem cannot be determined', () => {
    const graph = graphOf(
      [dependency('mystery'), pkg('odd', 'odd/Makefile'), pkg('other', 'other/Makefile')],
      [declares('odd', 'mystery'), declares('other', 'mystery')],
    );

    const result = assess(graph, 'mystery');

    expect(result.ubiquitous).toBe(false);
    expect(result.reason).toBe('ecosystem-unknown');
    expect(result.diagnostic).toContain('mystery');
  });

  it('counts a directory declaring two manifests once per ecosystem', () => {
    // A polyglot package appears as one node per manifest, so each ecosystem sees its own peer.
    const graph = graphOf(
      [
        dependency('grpc'),
        pkg('svc-npm', 'svc/package.json'),
        pkg('svc-maven', 'svc/pom.xml'),
        pkg('other-npm', 'other/package.json'),
      ],
      [declares('svc-npm', 'grpc')],
    );

    const result = assess(graph, 'grpc');

    expect(result.eligible).toBe(2);
  });
});
