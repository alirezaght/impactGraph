import { describe, expect, it } from 'vitest';

import { cliAcceptDeviationOutputSchema, cliSelectOptionOutputSchema } from '../index.js';

import { reviewArtifactSchema } from './review-artifact.js';

// Story 11.2 / 6.6 — fixture pairs + round-trips for the persisted review artifact and the
// two decision-command CLI documents (contract-testing rules, ADR-0009).

const validDocument = {
  schemaVersion: 1,
  command: 'review',
  reviewId: 'review-analysis-1-x1',
  analysis: {
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    approvedSnapshotId: 'snap-1',
  },
  target: 'working-tree',
  reviewSnapshotId: 'snap-2',
  changedFiles: ['src/rogue.ts'],
  findings: [
    {
      category: 'unexpected',
      nodeId: 'sym:rogue',
      nodeName: 'rogue',
      explanation: 'changed but not in the approved analysis',
      filePaths: ['src/rogue.ts'],
    },
  ],
  coverage: [],
  edgeChanges: { added: [], removed: [] },
  ruleViolations: [],
  discrepanciesFound: true,
} as const;

const validArtifact = {
  schemaVersion: 1,
  id: 'review-analysis-1-x1',
  createdAt: '2026-08-01T09:00:00.000Z',
  document: validDocument,
  acceptedDeviations: [
    {
      id: 'dev-1',
      nodeId: 'sym:rogue',
      category: 'unexpected',
      reason: 'intentional helper extracted during the change',
      actor: 'user',
      decidedAt: '2026-08-01T09:05:00.000Z',
    },
  ],
} as const;

describe('review artifact contract (Story 11.2, PRD §24.1/§28)', () => {
  it('accepts a valid artifact and round-trips identically', () => {
    const parsed = reviewArtifactSchema.parse(validArtifact);
    expect(reviewArtifactSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects unknown versions, unknown keys, and non-discrepancy categories', () => {
    expect(reviewArtifactSchema.safeParse({ ...validArtifact, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(reviewArtifactSchema.safeParse({ ...validArtifact, extra: true }).success).toBe(false);
    expect(
      reviewArtifactSchema.safeParse({
        ...validArtifact,
        acceptedDeviations: [{ ...validArtifact.acceptedDeviations[0], category: 'matched' }],
      }).success,
    ).toBe(false);
    expect(
      reviewArtifactSchema.safeParse({
        ...validArtifact,
        acceptedDeviations: [{ ...validArtifact.acceptedDeviations[0], reason: '' }],
      }).success,
    ).toBe(false);
  });

  it('the review document may carry the additive baseline-provenance block', () => {
    const baseline = {
      analysisId: 'analysis-1',
      status: 'draft',
      authority: 'unapproved-prediction',
      snapshotId: 'snap-1',
    } as const;
    const provisional = { ...validDocument, baseline };
    expect(
      reviewArtifactSchema.safeParse({ ...validArtifact, document: provisional }).success,
    ).toBe(true);
    // a superseded record can never be a baseline; the authority vocabulary is closed
    expect(
      reviewArtifactSchema.safeParse({
        ...validArtifact,
        document: { ...validDocument, baseline: { ...baseline, status: 'superseded' } },
      }).success,
    ).toBe(false);
    expect(
      reviewArtifactSchema.safeParse({
        ...validArtifact,
        document: { ...validDocument, baseline: { ...baseline, authority: 'approved' } },
      }).success,
    ).toBe(false);
  });

  it('the review document carries the acceptance mark without rewriting the finding', () => {
    const marked = {
      ...validDocument,
      findings: [
        { ...validDocument.findings[0], acceptedDeviation: { reason: 'intentional helper' } },
      ],
    };
    expect(reviewArtifactSchema.safeParse({ ...validArtifact, document: marked }).success).toBe(
      true,
    );
  });
});

describe('decision command outputs (PRD §20)', () => {
  it('select-option: valid/invalid fixture pair', () => {
    const valid = {
      schemaVersion: 1,
      command: 'select-option',
      analysisId: 'analysis-1',
      optionId: 'option:abc',
      specificationId: 'spec-1',
      specificationVersion: 2,
      decisionId: 'adr-option-abc-x1',
    };
    expect(cliSelectOptionOutputSchema.safeParse(valid).success).toBe(true);
    expect(
      cliSelectOptionOutputSchema.safeParse({ ...valid, specificationVersion: 0 }).success,
    ).toBe(false);
  });

  it('review-accept: valid/invalid fixture pair', () => {
    const valid = {
      schemaVersion: 1,
      command: 'review-accept',
      reviewId: 'review-analysis-1-x1',
      nodeId: 'sym:rogue',
      category: 'unexpected',
      reason: 'intentional helper',
      acceptedDeviationCount: 1,
    };
    expect(cliAcceptDeviationOutputSchema.safeParse(valid).success).toBe(true);
    expect(
      cliAcceptDeviationOutputSchema.safeParse({ ...valid, category: 'matched' }).success,
    ).toBe(false);
  });
});
