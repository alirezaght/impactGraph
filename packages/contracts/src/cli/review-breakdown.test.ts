import { describe, expect, it } from 'vitest';

import { cliReviewOutputSchema } from './outputs.js';
import { cliReviewBreakdownSchema } from './review-breakdown.js';

// Item 7 (dogfooding): the review must explain its own confidence and scope. The confidence
// block and the edge-truncation counts are additive optional v1 fields — documents produced
// before them must still validate.

const validBreakdown = {
  correctlyPredictedStructural: ['src/policy.ts'],
  missedChangedFiles: [],
  missedNewFiles: [],
  lexicalOnlyThatChanged: [],
  falseStrongPredictions: [],
  unexpectedChanges: ['src/mailer.ts'],
  asyncOrBoundaryChanges: [],
  configurationAndAssetChanges: [],
  contractChanges: [],
  migrationChanges: [],
  nonGoalContradictions: [{ statement: 'Reworking the mailer.', changedPaths: ['src/mailer.ts'] }],
  scope: {
    approvedSnapshotId: 'snap-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    changedFileCount: 2,
    indexedComponentCount: 40,
    limitations: [
      'Registered repository api-docs was not indexed; changes there were not reviewed.',
    ],
  },
};

describe('cliReviewBreakdownSchema (item 7: confidence and scope)', () => {
  it('accepts a breakdown without a confidence block (documents that predate it)', () => {
    expect(cliReviewBreakdownSchema.parse(validBreakdown)).toEqual(validBreakdown);
  });

  it('accepts a deterministic confidence block with human-readable reasons', () => {
    const withConfidence = {
      ...validBreakdown,
      confidence: {
        level: 'limited',
        reasons: ['1 of 3 predictions could not be verified against the diff.'],
      },
    };
    expect(cliReviewBreakdownSchema.parse(withConfidence)).toEqual(withConfidence);
  });

  it('rejects unknown confidence levels and empty reason strings', () => {
    const badLevel = { ...validBreakdown, confidence: { level: 'certain', reasons: ['x'] } };
    expect(cliReviewBreakdownSchema.safeParse(badLevel).success).toBe(false);
    const blankReason = { ...validBreakdown, confidence: { level: 'high', reasons: [''] } };
    expect(cliReviewBreakdownSchema.safeParse(blankReason).success).toBe(false);
  });

  it('requires at least one reason — an unexplained confidence level is not self-explaining', () => {
    const noReasons = { ...validBreakdown, confidence: { level: 'high', reasons: [] } };
    expect(cliReviewBreakdownSchema.safeParse(noReasons).success).toBe(false);
  });
});

describe('cliReviewOutputSchema edge-change truncation (item 7: no silent truncation)', () => {
  const validReview = {
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

  it('accepts edge changes without omitted counts (documents that predate them)', () => {
    expect(cliReviewOutputSchema.parse(validReview)).toEqual(validReview);
  });

  it('accepts additive omitted counts and rejects negative ones', () => {
    const truncated = {
      ...validReview,
      edgeChanges: { added: ['e-1'], removed: [], omittedAdded: 5, omittedRemoved: 2 },
    };
    expect(cliReviewOutputSchema.parse(truncated)).toEqual(truncated);
    const negative = {
      ...validReview,
      edgeChanges: { added: [], removed: [], omittedAdded: -1 },
    };
    expect(cliReviewOutputSchema.safeParse(negative).success).toBe(false);
  });
});
