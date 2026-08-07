import {
  createImpactAnalysis,
  createImplementationReview,
  createKnowledgeGraph,
  createSpecification,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { renderReview } from './review-render.js';

import type { CliReviewOutput } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  Specification,
} from '@impactgraph/domain';
import type { ReviewBreakdownContext } from '@impactgraph/workspace-engine';

// Item 7: the CLI text report renders the classified drift block — named endpoints, categories,
// counted omissions — and stays silent for documents that predate it.

const review = (): ImplementationReview => {
  const result = createImplementationReview({
    id: 'review-1',
    analysisId: 'analysis-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    createdAt: '2026-08-06T12:00:00.000Z',
    changedFiles: ['src/billing/api.ts'],
    findings: [],
    coverage: [],
    edgeChanges: { added: ['e-1'], removed: [] },
  });
  if (!result.ok) {
    throw new Error('review invalid');
  }
  return result.value;
};

const analysis = (): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-06T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: [],
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
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
    rawText: 'Deals must expire.',
    version: 1,
    createdAt: '2026-08-06T10:00:00.000Z',
    updatedAt: '2026-08-06T10:00:00.000Z',
    requirements: [],
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

const emptyGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph([], []);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const drift: NonNullable<CliReviewOutput['drift']> = {
  entries: [
    {
      edgeId: 'e-1',
      edgeType: 'IMPORTS',
      direction: 'added',
      category: 'cross-context',
      from: { nodeId: 'svc:billing', nodeName: 'BillingService', context: 'billing' },
      to: { nodeId: 'svc:deals', nodeName: 'DealService', context: 'deals' },
    },
  ],
  omitted: [{ category: 'other', count: 2 }],
  unmappedContexts: { contexts: ['billing'] },
};

const render = (breakdownContext?: ReviewBreakdownContext): string[] => {
  const lines: string[] = [];
  renderReview(
    { rootDir: '/tmp', format: 'text', args: [], write: (line) => lines.push(line) },
    {
      review: review(),
      analysis: analysis(),
      violations: [],
      ...(breakdownContext === undefined ? {} : { breakdownContext }),
    },
  );
  return lines;
};

describe('review text output — architectural drift (item 7)', () => {
  it('renders classified entries with contexts, plus counted omissions and unmapped contexts', () => {
    const lines = render({ specification: specification(), currentGraph: emptyGraph(), drift });
    const text = lines.join('\n');
    expect(text).toContain(
      '[cross-context] BillingService (billing) -> DealService (deals) (IMPORTS, added)',
    );
    expect(text).toContain('2 more other entries omitted.');
    expect(text).toContain('Contexts touched outside the approved footprint: billing');
  });

  it('renders no drift section for documents that predate the block', () => {
    expect(render().join('\n')).not.toContain('Architectural drift');
  });
});
