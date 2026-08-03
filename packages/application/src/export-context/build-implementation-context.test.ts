import {
  createGraphEdge,
  createGraphNode,
  createImpactAnalysis,
  createKnowledgeGraph,
  createSpecification,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImplementationContext } from './build-implementation-context.js';

import type { BuildImplementationContextRequest, ImplementationContext } from '../index.js';
import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-01T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (input: {
  id: string;
  category: string;
  type: string;
  name: string;
  path: string;
}): GraphNode => {
  const result = createGraphNode({ ...input, knowledge });
  if (!result.ok) {
    throw new Error(`node ${input.id}`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const buildGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node({
        id: 'sym:service',
        category: 'application',
        type: 'service',
        name: 'DealService',
        path: 'src/deal-service.ts',
      }),
      node({
        id: 'sym:schema',
        category: 'data',
        type: 'table',
        name: 'Deal',
        path: 'prisma/schema.prisma',
      }),
      node({
        id: 'test:service',
        category: 'application',
        type: 'test',
        name: 'deal-service.test.ts',
        path: 'src/deal-service.test.ts',
      }),
    ],
    [edge('e1', 'TESTS', 'test:service', 'sym:service')],
  );
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const impact = (
  nodeId: string,
  likelihood: RequirementImpact['likelihood'],
  impactType: RequirementImpact['impactType'] = 'business-rule',
): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId,
  likelihood,
  impactType,
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
  status: ImpactAnalysis['status'],
  impacts: RequirementImpact[],
  decisions: ImpactAnalysis['userDecisions'] = [],
): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-01T10:00:00.000Z',
    status,
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [{ code: 'traversal-cutoff', message: 'depth limit reached' }],
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
    title: 'Deal filtering',
    sourceType: 'markdown',
    rawText: 'DealService must filter expired deals.',
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'DealService must filter expired deals.',
        type: 'functional',
        concepts: ['DealService'],
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

const build = (
  overrides: Partial<BuildImplementationContextRequest> = {},
): ImplementationContext => {
  const result = buildImplementationContext({
    specification: specification(),
    analysis: analysis('approved', [
      impact('sym:service', 'required'),
      impact('sym:schema', 'likely', 'data-model'),
    ]),
    graph: buildGraph(),
    snapshot: {
      id: 'snap-1',
      branch: 'main',
      commitSha: 'abc123',
      dirtyWorkingTree: false,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
    constraints: [
      {
        id: 'schema-needs-migration',
        type: 'accompanying-change',
        whenChanged: 'prisma/schema.prisma',
        requireChanged: 'prisma/migrations/**',
      },
    ],
    ...overrides,
  });
  if (!result.ok) {
    throw new Error('build failed');
  }
  return result.value;
};

describe('buildImplementationContext (Story 10.1, PRD §22)', () => {
  it('refuses to export anything but an approved analysis (§40.3)', () => {
    for (const status of ['draft', 'reviewed', 'superseded'] as const) {
      const result = buildImplementationContext({
        specification: specification(),
        analysis: analysis(status, [impact('sym:service', 'required')]),
        graph: buildGraph(),
        snapshot: {
          id: 'snap-1',
          commitSha: 'abc123',
          dirtyWorkingTree: false,
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        constraints: [],
      });
      expect(result.ok).toBe(false);
    }
  });

  it('splits impacts into required/likely and resolves names and paths from the graph', () => {
    const context = build();
    expect(context.requiredImpacts.map((impact) => impact.name)).toEqual(['DealService']);
    expect(context.requiredImpacts[0]?.path).toBe('src/deal-service.ts');
    expect(context.likelyImpacts.map((impact) => impact.name)).toEqual(['Deal']);
    expect(context.rejectedImpacts).toEqual([]);
  });

  it('keeps rejected impacts visible in their own §22 bucket', () => {
    const context = build({
      analysis: analysis(
        'approved',
        [impact('sym:service', 'required'), impact('sym:schema', 'likely', 'data-model')],
        [
          {
            id: 'dec-1',
            requirementId: 'req-1',
            nodeId: 'sym:schema',
            decision: 'rejected',
            decidedAt: '2026-08-01T09:00:00.000Z',
          },
        ],
      ),
    });
    expect(context.rejectedImpacts.map((impact) => impact.name)).toEqual(['Deal']);
    expect(context.likelyImpacts).toEqual([]);
  });

  it('derives expected migrations from impact types and tests from TESTS edges', () => {
    const context = build();
    expect(context.expectedMigrations.map((expectation) => expectation.name)).toEqual(['Deal']);
    expect(context.expectedTests.map((expectation) => expectation.name)).toContain(
      'deal-service.test.ts',
    );
  });

  it('emits review criteria for required impacts and architecture constraints', () => {
    const context = build();
    const kinds = context.reviewCriteria.map((criterion) => criterion.kind);
    expect(kinds).toContain('required-impact');
    expect(kinds).toContain('architecture-rule');
    expect(
      context.reviewCriteria.find((criterion) => criterion.kind === 'required-impact')?.nodeId,
    ).toBe('sym:service');
    expect(context.openWarnings[0]?.code).toBe('traversal-cutoff');
  });
});
