import { createGraphNode, createKnowledgeGraph, createSpecification } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { summaryCounts } from './impact-summary-facts.js';
import { buildImpactSummary } from './impact-summary.js';

import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type {
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

// Item 6 — `counts.byRepository`: the analyze summary states which registered repositories the
// change spans, derived from the roster prefixes at answer time. Single-repository workspaces
// get no such block: "all in this one" is noise, not information.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-06T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, path: string): GraphNode => {
  const created = createGraphNode({
    id,
    name: id,
    category: 'application',
    type: 'service',
    path,
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${id}`);
  }
  return created.value;
};

const graph = (): KnowledgeGraph => {
  const created = createKnowledgeGraph(
    [node('sym:deal', 'src/deal.ts'), node('sym:billing', 'billing/src/api.ts')],
    [],
  );
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const impactFor = (requirementId: string, nodeId: string): RequirementImpact => ({
  requirementId,
  nodeId,
  likelihood: 'required',
  impactType: 'domain-model',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: 'matched',
  expectedChanges: ['review'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis',
  evidenceTypes: ['direct-structural'],
});

const analysis = (): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-06T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [impactFor('req-1', 'sym:deal'), impactFor('req-1', 'sym:billing')],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

const specification = (): Specification => {
  const created = createSpecification({
    id: 'spec-1',
    title: 'repository dimension fixture',
    sourceType: 'markdown',
    rawText: 'fixture',
    version: 1,
    createdAt: '2026-08-06T10:00:00.000Z',
    updatedAt: '2026-08-06T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'DealService must call BillingApi.',
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
  if (!created.ok) {
    throw new Error('bad fixture spec');
  }
  return created.value;
};

const multiRepoContext: WorkspaceRepositoryContext = {
  repositories: [
    { name: '(workspace root)', indexed: true, fileCount: 10 },
    { name: 'billing', path: 'billing', indexed: true, fileCount: 4 },
  ],
  candidates: [],
  limitations: [],
};

describe('counts.byRepository (item 6)', () => {
  it('states the repositories the change spans when related repositories are registered', () => {
    const counts = summaryCounts(analysis(), {
      graph: graph(),
      repositories: multiRepoContext.repositories,
    });
    expect(counts.byRepository).toEqual({ '(workspace root)': 1, billing: 1 });
  });

  it('is absent when only the workspace root exists', () => {
    const counts = summaryCounts(analysis(), {
      graph: graph(),
      repositories: [{ name: '(workspace root)' }],
    });
    expect(counts.byRepository).toBeUndefined();
  });

  it('flows into the bounded summary through the workspace context', () => {
    const summary = buildImpactSummary({
      specification: specification(),
      analysis: analysis(),
      graph: graph(),
      freshness: { state: 'current', stale: false, reasons: [] },
      extractionMode: 'unchanged',
      indexWarnings: [],
      workspace: multiRepoContext,
    });
    expect(summary.counts.byRepository).toEqual({ '(workspace root)': 1, billing: 1 });
  });

  it('is absent from the summary when no workspace context is available', () => {
    const summary = buildImpactSummary({
      specification: specification(),
      analysis: analysis(),
      graph: graph(),
      freshness: { state: 'current', stale: false, reasons: [] },
      extractionMode: 'unchanged',
      indexWarnings: [],
    });
    expect(summary.counts.byRepository).toBeUndefined();
  });
});
