import {
  createGraphNode,
  createImpactAnalysis,
  createKnowledgeGraph,
  createSpecification,
  hasDiscrepancies,
  reviewVerdict,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { compareImplementation } from './compare-implementation.js';

import type { ChangedPath } from '../ports/git.js';
import type {
  GraphNode,
  ImplementationReview,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

/**
 * A regression boundary is verified, not assumed. "The send job must not change behavior" is the
 * one requirement a review can settle with certainty from a diff — either the protected surface
 * moved or it did not — and each answer has to read as what it is: a violated boundary, or a
 * boundary that held. Neither is "planned reuse", which is a statement about design intent.
 */

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
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

const graph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph([node('sym:sendJob', 'SendJob', 'src/jobs/send.ts')], []);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const impact = (changeExpectation: 'preserve' | 'must-change'): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId: 'sym:sendJob',
  likelihood: 'required',
  impactType: 'business-rule',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: 'the specification protects this surface',
  expectedChanges: ['no behavioural change'],
  evidenceIds: ['ev-1'],
  dependencyPath: ['sym:sendJob'],
  provenance: 'static-analysis',
  evidenceTypes: ['direct-structural'],
  changeExpectation,
});

const specification = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'digest',
    sourceType: 'markdown',
    rawText: 'The send job must not change behavior.',
    version: 1,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'The send job must not change behavior.',
        type: 'functional',
        concepts: ['SendJob'],
        actors: [],
        status: 'draft',
        intent: 'preserve',
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

const review = (impacts: RequirementImpact[], changes: ChangedPath[]): ImplementationReview => {
  const analysis = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-17T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    warnings: [],
    userDecisions: [],
    architecturalOptions: [],
  });
  if (!analysis.ok) {
    throw new Error('analysis invalid');
  }
  const result = compareImplementation({
    analysis: analysis.value,
    specification: specification(),
    approvedGraph: graph(),
    currentGraph: graph(),
    changes,
    target: 'working-tree',
    reviewSnapshotId: 'snap-2',
    reviewId: 'review-1',
    createdAt: '2026-08-18T10:00:00.000Z',
  });
  if (!result.ok) {
    throw new Error('comparison failed');
  }
  return result.value;
};

describe('review of a protected surface that changed', () => {
  const result = review(
    [impact('preserve')],
    [{ path: 'src/jobs/send.ts', changeType: 'modified' }],
  );
  const finding = result.findings.find((entry) => entry.nodeId === 'sym:sendJob');

  it('reports a guard violation, not a generic divergence', () => {
    expect(finding?.category).toBe('guard-violated');
  });

  it('says which boundary broke, and where', () => {
    expect(finding?.explanation).toContain('regression boundary');
    expect(finding?.explanation).toContain('src/jobs/send.ts');
  });

  it('is a discrepancy, and the verdict needs attention', () => {
    expect(hasDiscrepancies(result)).toBe(true);
    expect(
      reviewVerdict({ findings: result.findings, ruleViolationCount: 0, acceptedNodeIds: [] })
        .status,
    ).toBe('NEEDS_ATTENTION');
  });

  it('does not credit the requirement with coverage', () => {
    expect(result.coverage[0]?.status).toBe('not-found');
    expect(result.coverage[0]?.evidence[0]?.marker).toBe('missing');
  });
});

describe('review of a protected surface that was left alone', () => {
  const result = review([impact('preserve')], []);
  const finding = result.findings.find((entry) => entry.nodeId === 'sym:sendJob');

  it('reports it positively', () => {
    expect(finding?.category).toBe('reuse-confirmed');
  });

  it('says the boundary held rather than claiming planned reuse', () => {
    expect(finding?.explanation).toContain('Regression boundary held');
    expect(finding?.explanation).not.toContain('Planned reuse');
  });

  it('counts the guard as a satisfied requirement — the verification value of stating it', () => {
    expect(result.coverage[0]?.status).toBe('implemented');
    expect(result.coverage[0]?.evidence[0]?.marker).toBe('confirmed');
  });

  it('passes', () => {
    expect(hasDiscrepancies(result)).toBe(false);
    expect(
      reviewVerdict({ findings: result.findings, ruleViolationCount: 0, acceptedNodeIds: [] })
        .status,
    ).toBe('PASS');
  });
});
