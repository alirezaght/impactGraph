import { describe, expect, it } from 'vitest';

import { buildReviewMarkdown } from './review-markdown.js';

import type { CliReviewOutput } from '@impactgraph/contracts';

// Item 7: the human-facing report must state its own scope, limitations, and confidence —
// a review whose silence cannot be distinguished from blindness is unreadable.

const baseReport: CliReviewOutput = {
  schemaVersion: 1,
  command: 'review',
  analysis: {
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    approvedSnapshotId: 'snap-1',
  },
  target: 'working-tree',
  reviewSnapshotId: 'snap-2',
  changedFiles: ['src/policy.ts'],
  findings: [],
  coverage: [],
  edgeChanges: { added: ['e-1'], removed: [] },
  ruleViolations: [],
  discrepanciesFound: false,
};

const breakdown: NonNullable<CliReviewOutput['breakdown']> = {
  correctlyPredictedStructural: ['src/policy.ts'],
  missedChangedFiles: [],
  missedNewFiles: [],
  lexicalOnlyThatChanged: [],
  falseStrongPredictions: [],
  unexpectedChanges: [],
  asyncOrBoundaryChanges: [],
  configurationAndAssetChanges: [],
  contractChanges: [],
  migrationChanges: [],
  nonGoalContradictions: [],
  scope: {
    approvedSnapshotId: 'snap-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    changedFileCount: 1,
    indexedComponentCount: 40,
    limitations: [
      "Registered repository 'api-docs' was not indexed; changes there were not reviewed.",
    ],
  },
  confidence: {
    level: 'low',
    reasons: ["Registered repository 'api-docs' was not indexed, so its changes were invisible."],
  },
};

describe('buildReviewMarkdown scope and confidence (item 7)', () => {
  it('renders the confidence level, its reasons, and each measured limitation', () => {
    const markdown = buildReviewMarkdown({ ...baseReport, breakdown }).join('\n');
    expect(markdown).toContain('## Scope and Confidence');
    expect(markdown).toContain('Confidence: **low**');
    expect(markdown).toContain('invisible');
    expect(markdown).toContain("Registered repository 'api-docs' was not indexed");
  });

  it('states edge-change truncation instead of truncating silently', () => {
    const markdown = buildReviewMarkdown({
      ...baseReport,
      edgeChanges: { added: ['e-1'], removed: [], omittedAdded: 5 },
    }).join('\n');
    expect(markdown).toContain('5 more omitted');
  });

  it('omits the section for documents that predate the breakdown, without failing', () => {
    const markdown = buildReviewMarkdown(baseReport).join('\n');
    expect(markdown).not.toContain('## Scope and Confidence');
    expect(markdown).toContain('# Implementation Review');
  });
});

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

describe('buildReviewMarkdown drift section (item 7)', () => {
  it('renders classified drift with named endpoints, contexts, and counted omissions', () => {
    const markdown = buildReviewMarkdown({ ...baseReport, drift }).join('\n');
    expect(markdown).toContain('## Architectural Drift');
    expect(markdown).toContain('for human judgment, not a verdict');
    expect(markdown).toContain(
      '**cross-context** — BillingService [billing] → DealService [deals] (IMPORTS, added)',
    );
    expect(markdown).toContain('2 more other entries omitted');
    expect(markdown).toContain('Contexts touched outside the approved footprint: billing');
  });

  it('omits the drift section for documents that predate the block', () => {
    expect(buildReviewMarkdown(baseReport).join('\n')).not.toContain('## Architectural Drift');
  });

  it('says so when drift was assessed and nothing was found', () => {
    const markdown = buildReviewMarkdown({
      ...baseReport,
      drift: { entries: [], omitted: [], unmappedContexts: { contexts: [] } },
    }).join('\n');
    expect(markdown).toContain('none among the reported edge changes');
    expect(markdown).toContain('Every context touched by the diff is inside the approved footprint.');
  });
});
