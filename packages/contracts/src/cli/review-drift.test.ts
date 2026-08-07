import { describe, expect, it } from 'vitest';

import { cliReviewDriftSchema } from './review-drift.js';
import { cliReviewOutputSchema } from './review-output.js';

// Item 7: the classified drift block — additive, bounded, honest about absent boundaries.

const entry = {
  edgeId: 'edge:imports:billing:deals',
  edgeType: 'IMPORTS',
  direction: 'added',
  category: 'cross-context',
  from: { nodeId: 'svc:billing', nodeName: 'BillingService', context: 'billing' },
  to: { nodeId: 'svc:deals', nodeName: 'DealService', context: 'deals' },
} as const;

const drift = {
  entries: [entry],
  omitted: [{ category: 'other', count: 3 }],
  unmappedContexts: { contexts: ['billing'] },
} as const;

describe('cliReviewDriftSchema', () => {
  it('accepts a classified drift block with boundary qualifiers', () => {
    expect(cliReviewDriftSchema.safeParse(drift).success).toBe(true);
  });

  it('accepts endpoints without context/repository — boundary unknown, never guessed', () => {
    const bare = {
      entries: [
        {
          ...entry,
          category: 'new-dependency',
          from: { nodeId: 'a', nodeName: 'A' },
          to: { nodeId: 'b', nodeName: 'B' },
        },
      ],
      omitted: [],
    };
    expect(cliReviewDriftSchema.safeParse(bare).success).toBe(true);
  });

  it('rejects unknown drift categories and unknown fields', () => {
    expect(
      cliReviewDriftSchema.safeParse({
        entries: [{ ...entry, category: 'suspicious' }],
        omitted: [],
      }).success,
    ).toBe(false);
    expect(cliReviewDriftSchema.safeParse({ ...drift, verdict: 'fail' }).success).toBe(false);
  });

  it('rejects zero-count omissions — an empty truncation is not a truncation', () => {
    expect(
      cliReviewDriftSchema.safeParse({ entries: [], omitted: [{ category: 'other', count: 0 }] })
        .success,
    ).toBe(false);
  });
});

describe('cliReviewOutputSchema.drift', () => {
  const document = {
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
    changedFiles: ['src/billing/service.ts'],
    findings: [],
    coverage: [],
    edgeChanges: { added: ['edge:imports:billing:deals'], removed: [] },
    ruleViolations: [],
    discrepanciesFound: false,
  } as const;

  it('stays valid without drift — producers that predate the block still parse', () => {
    expect(cliReviewOutputSchema.safeParse(document).success).toBe(true);
  });

  it('accepts the additive drift block', () => {
    expect(cliReviewOutputSchema.safeParse({ ...document, drift }).success).toBe(true);
  });
});
