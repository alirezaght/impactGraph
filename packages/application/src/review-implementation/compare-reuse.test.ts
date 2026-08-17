import {
  createGraphNode,
  createImpactAnalysis,
  createKnowledgeGraph,
  createSpecification,
  hasDiscrepancies,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { compareImplementation } from './compare-implementation.js';

import type { ChangedPath } from '../ports/git.js';
import type {
  ChangeExpectation,
  GraphNode,
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

// ADR-0022: a predicted surface that stayed unchanged because the plan said it would be reused is
// the plan working. Before this, review called it a missing requirement and coverage said
// not-found, which punished the correct decision to reuse existing behaviour untouched.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
} as const;

const node = (id: string, name: string, path: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'application',
    type: 'service',
    name,
    path,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const nodes = (): GraphNode[] => [
  node('sym:renderer', 'DigestRenderer', 'src/render/digest.ts'),
  node('sym:policy', 'AlertPolicy', 'src/policy.ts'),
];

const graph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes(), []);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const impact = (nodeId: string, changeExpectation?: ChangeExpectation): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId,
  likelihood: 'required',
  impactType: 'business-rule',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: `predicted surface ${nodeId}`,
  expectedChanges: ['reuse as-is'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis',
  evidenceTypes: ['direct-structural'],
  ...(changeExpectation === undefined ? {} : { changeExpectation }),
});

const specification = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'digest',
    sourceType: 'markdown',
    rawText: 'Reuse the existing DigestRenderer without modification.',
    version: 1,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'Reuse the existing DigestRenderer without modification.',
        type: 'functional',
        concepts: ['DigestRenderer'],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('specification invalid');
  }
  return result.value;
};

const analysis = (impacts: RequirementImpact[]): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-07-31T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    warnings: [],
    userDecisions: [],
    architecturalOptions: [],
  });
  if (!result.ok) {
    throw new Error('analysis invalid');
  }
  return result.value;
};

const review = (impacts: RequirementImpact[], changes: ChangedPath[]): ImplementationReview => {
  const result = compareImplementation({
    analysis: analysis(impacts),
    specification: specification(),
    approvedGraph: graph(),
    currentGraph: graph(),
    changes,
    target: 'working-tree',
    reviewSnapshotId: 'snap-2',
    reviewId: 'review-1',
    createdAt: '2026-08-01T10:00:00.000Z',
  });
  if (!result.ok) {
    throw new Error('comparison failed');
  }
  return result.value;
};

describe('reuse-aware review classification (ADR-0022)', () => {
  it('reports a planned reuse that stayed unchanged as satisfied, not missing', () => {
    const result = review([impact('sym:renderer', 'reuse-unchanged')], []);

    const finding = result.findings.find((entry) => entry.nodeId === 'sym:renderer');
    expect(finding?.category).toBe('reuse-confirmed');
    expect(finding?.explanation).toContain('reused unchanged by design');
    expect(hasDiscrepancies(result)).toBe(false);
    expect(result.coverage[0]?.status).toBe('implemented');
  });

  it('reports a verify-only surface that stayed unchanged as verified', () => {
    const result = review([impact('sym:renderer', 'verify-only')], []);

    expect(result.findings[0]?.category).toBe('reuse-confirmed');
    expect(hasDiscrepancies(result)).toBe(false);
  });

  it('flags a planned reuse that was modified as divergent', () => {
    const result = review(
      [impact('sym:renderer', 'reuse-unchanged')],
      [{ path: 'src/render/digest.ts', changeType: 'modified' }],
    );

    const finding = result.findings.find((entry) => entry.nodeId === 'sym:renderer');
    expect(finding?.category).toBe('divergent');
    expect(finding?.explanation).toContain('planned as reuse');
    expect(hasDiscrepancies(result)).toBe(true);
  });

  it('still reports an unchanged must-change surface as missing', () => {
    const result = review([impact('sym:policy')], []);

    expect(result.findings[0]?.category).toBe('missing');
    expect(hasDiscrepancies(result)).toBe(true);
  });

  it('counts reuse alongside a real change as full coverage of the requirement', () => {
    const result = review(
      [impact('sym:renderer', 'reuse-unchanged'), impact('sym:policy')],
      [{ path: 'src/policy.ts', changeType: 'modified' }],
    );

    expect(result.coverage[0]?.status).toBe('implemented');
    expect(hasDiscrepancies(result)).toBe(false);
  });
});
