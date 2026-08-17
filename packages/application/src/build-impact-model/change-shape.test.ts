import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { assessChangeShape, traversalFor } from './change-shape.js';

import type { ConceptMatch } from './concept-matching.js';
import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// ADR-0023: a change contained in one package, touching no queue/contract/deployment surface, is
// exhaustively traceable by reading the code. Spending an eight-hop chain walk on it buys nothing.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
} as const;

const node = (
  id: string,
  type: string,
  path: string,
  category: 'application' | 'integration' = 'application',
): GraphNode => {
  const result = createGraphNode({
    id,
    category,
    type,
    name: id,
    path,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`bad node ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const graphOf = (nodes: GraphNode[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, []);
  if (!result.ok) {
    throw new Error('bad graph');
  }
  return result.value;
};

const match = (nodeId: string): ConceptMatch => ({
  concept: nodeId,
  nodeId,
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
});

const packageNode = (name: string): GraphNode =>
  node(`package:${name}`, 'package', `packages/${name}/package.json`);

describe('assessChangeShape', () => {
  it('calls a change contained when every anchor lives in one component', () => {
    const graph = graphOf([
      packageNode('alerts'),
      node('sym:policy', 'service', 'packages/alerts/src/policy.ts'),
      node('sym:rules', 'service', 'packages/alerts/src/rules.ts'),
    ]);

    const assessment = assessChangeShape(graph, [match('sym:policy'), match('sym:rules')]);

    expect(assessment.shape).toBe('contained');
    expect(assessment.containerCount).toBe(1);
  });

  it('calls a change distributed when its anchors span components', () => {
    const graph = graphOf([
      packageNode('alerts'),
      packageNode('billing'),
      node('sym:policy', 'service', 'packages/alerts/src/policy.ts'),
      node('sym:invoice', 'service', 'packages/billing/src/invoice.ts'),
    ]);

    const assessment = assessChangeShape(graph, [match('sym:policy'), match('sym:invoice')]);

    expect(assessment.shape).toBe('distributed');
    expect(assessment.reason).toContain('spans');
  });

  it('calls a change distributed when it touches a surface whose consumers are invisible', () => {
    const graph = graphOf([
      packageNode('alerts'),
      node('sym:policy', 'service', 'packages/alerts/src/policy.ts'),
      node('topic:alert-raised', 'topic', 'packages/alerts/infra/topics.tf', 'integration'),
    ]);

    const assessment = assessChangeShape(graph, [match('sym:policy'), match('topic:alert-raised')]);

    expect(assessment.shape).toBe('distributed');
    expect(assessment.reason).toContain('consumers');
  });

  it('claims no containment when nothing resolved', () => {
    expect(assessChangeShape(graphOf([packageNode('alerts')]), []).shape).toBe('distributed');
  });
});

describe('traversalFor', () => {
  it('shortens the chain walk for a contained change', () => {
    expect(traversalFor('contained').maxChainHops).toBe(1);
    expect(traversalFor('contained').maxExpansions).toBeLessThan(20_000);
  });

  it('leaves the full budget in place for a distributed change', () => {
    expect(traversalFor('distributed')).toEqual({});
  });
});
