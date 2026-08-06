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
