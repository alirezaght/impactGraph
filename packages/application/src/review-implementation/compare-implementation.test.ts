import {
  createGraphEdge,
  createGraphNode,
  createImpactAnalysis,
  createKnowledgeGraph,
  createSpecification,
  hasDiscrepancies,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { compareImplementation } from './compare-implementation.js';

import type { CompareImplementationRequest } from './compare-implementation.js';
import type { ChangedPath } from '../ports/git.js';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
  UserImpactDecision,
} from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path?: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'application',
    type: 'service',
    name,
    knowledge,
    ...(path === undefined ? {} : { path }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type: 'CALLS', sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const graph = (nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const impact = (
  nodeId: string,
  likelihood: RequirementImpact['likelihood'],
): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId,
  likelihood,
  impactType: 'business-rule',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: `predicted change to ${nodeId}`,
  expectedChanges: ['update logic'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis',
});

const analysis = (
  impacts: RequirementImpact[],
  decisions: UserImpactDecision[] = [],
): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-07-31T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [],
    userDecisions: decisions,
  });
  if (!result.ok) {
    throw new Error('analysis invalid');
  }
  return result.value;
};

const specification = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: 'Policy must hide expired deals.',
    version: 1,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'Policy must hide expired deals.',
        type: 'functional',
        concepts: ['policy'],
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
    throw new Error('spec invalid');
  }
  return result.value;
};

const approvedNodes = (): GraphNode[] => [
  node('sym:policy', 'Policy', 'src/policy.ts'),
  node('sym:query', 'QueryService', 'src/query.ts'),
  node('sym:extra', 'Extra', 'src/extra.ts'),
  node('sym:removed', 'Removed', 'src/removed.ts'),
  node('sym:rejected', 'Rejected', 'src/rejected.ts'),
  node('topic:deal-updated', 'deal-updated'),
];

const review = (input: Partial<CompareImplementationRequest>): ImplementationReview => {
  const request: CompareImplementationRequest = {
    reviewId: 'review-1',
    analysis: analysis([]),
    specification: specification(),
    approvedGraph: graph(approvedNodes(), []),
    currentGraph: graph(approvedNodes(), []),
    changes: [],
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    createdAt: '2026-07-31T12:00:00.000Z',
    ...input,
  };
  const result = compareImplementation(request);
  if (!result.ok) {
    throw new Error('comparison failed');
  }
  return result.value;
};

const categoriesByNode = (result: ImplementationReview): Map<string, string> =>
  new Map(result.findings.map((finding) => [finding.nodeId, finding.category]));

describe('compareImplementation (Stories 11.2/11.3, PRD §24.1/§25)', () => {
  it('classifies matched, missing, divergent, unverifiable, and unexpected findings', () => {
    const currentNodes = approvedNodes().filter((candidate) => candidate.id !== 'sym:removed');
    const result = review({
      analysis: analysis([
        impact('sym:policy', 'required'),
        impact('sym:query', 'required'),
        impact('sym:removed', 'required'),
        impact('topic:deal-updated', 'required'),
      ]),
      currentGraph: graph(currentNodes, []),
      changes: [
        { path: 'src/policy.ts', changeType: 'modified' },
        { path: 'src/removed.ts', changeType: 'modified' },
        { path: 'src/surprise.ts', changeType: 'added' },
      ],
    });
    const categories = categoriesByNode(result);
    expect(categories.get('sym:policy')).toBe('matched');
    expect(categories.get('sym:query')).toBe('missing');
    expect(categories.get('sym:removed')).toBe('divergent');
    expect(categories.get('topic:deal-updated')).toBe('unverifiable');
    expect(categories.get('file:src/surprise.ts')).toBe('unexpected');
    expect(hasDiscrepancies(result)).toBe(true);
  });

  it('reports no discrepancies when every required impact changed as predicted', () => {
    const result = review({
      analysis: analysis([impact('sym:policy', 'required'), impact('sym:extra', 'possible')]),
      changes: [{ path: 'src/policy.ts', changeType: 'modified' }],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe('matched');
    expect(hasDiscrepancies(result)).toBe(false);
    expect(result.coverage[0]?.status).toBe('implemented');
    expect(result.coverage[0]?.evidence[0]?.marker).toBe('confirmed');
  });

  it('does not flag an unchanged likely/possible impact as a discrepancy', () => {
    const result = review({
      analysis: analysis([impact('sym:extra', 'possible'), impact('sym:query', 'likely')]),
      changes: [],
    });
    expect(result.findings).toHaveLength(0);
    expect(result.coverage[0]?.status).toBe('unclear');
  });

  it('skips rejected impacts so their files surface as unexpected (§40.3 decisions applied)', () => {
    const result = review({
      analysis: analysis(
        [impact('sym:rejected', 'required')],
        [
          {
            id: 'dec-1',
            requirementId: 'req-1',
            nodeId: 'sym:rejected',
            decision: 'rejected',
            decidedAt: '2026-07-31T11:00:00.000Z',
          },
        ],
      ),
      changes: [{ path: 'src/rejected.ts', changeType: 'modified' }],
    });
    const categories = categoriesByNode(result);
    expect(categories.has('sym:rejected')).toBe(false);
    expect(categories.get('file:src/rejected.ts')).toBe('unexpected');
  });

  it('treats a rename as one change covering both paths — never a missing/unexpected pair', () => {
    const changes: ChangedPath[] = [
      { path: 'src/policy-renamed.ts', changeType: 'renamed', previousPath: 'src/policy.ts' },
    ];
    const result = review({
      analysis: analysis([impact('sym:policy', 'required')]),
      changes,
    });
    const categories = categoriesByNode(result);
    expect(categories.get('sym:policy')).toBe('matched');
    expect([...categories.values()].filter((value) => value === 'unexpected')).toHaveLength(0);
  });

  it('ignores internal noise paths like .impactgraph/', () => {
    const result = review({
      changes: [{ path: '.impactgraph/index.db', changeType: 'added' }],
    });
    expect(result.findings).toHaveLength(0);
    expect(result.changedFiles).toHaveLength(0);
  });

  it('reports edge additions and removals touching changed files', () => {
    const result = review({
      analysis: analysis([impact('sym:policy', 'required')]),
      approvedGraph: graph(approvedNodes(), [edge('e-old', 'sym:policy', 'sym:extra')]),
      currentGraph: graph(approvedNodes(), [edge('e-new', 'sym:policy', 'sym:query')]),
      changes: [{ path: 'src/policy.ts', changeType: 'modified' }],
    });
    expect(result.edgeChanges.added).toEqual(['e-new']);
    expect(result.edgeChanges.removed).toEqual(['e-old']);
  });

  it('marks partially-implemented coverage when some required impacts are missing (§25)', () => {
    const result = review({
      analysis: analysis([impact('sym:policy', 'required'), impact('sym:query', 'required')]),
      changes: [{ path: 'src/policy.ts', changeType: 'modified' }],
    });
    expect(result.coverage[0]?.status).toBe('partially-implemented');
    const markers = result.coverage[0]?.evidence.map((line) => line.marker) ?? [];
    expect(markers).toContain('confirmed');
    expect(markers).toContain('missing');
  });
});
