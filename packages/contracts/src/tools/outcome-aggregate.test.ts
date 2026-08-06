import { describe, expect, it } from 'vitest';

import { OUTCOME_TOOL_CONTRACTS, outcomeAggregateSchema } from './outcome-tools.js';

// Dogfooding item 8 — the aggregate accuracy block on `record_actual_impact`. Additive v1: a v1
// reader that ignores the new optional field still validates, and an old payload without it does too.

const output = OUTCOME_TOOL_CONTRACTS.record_actual_impact.output;

const minimalMetrics = {
  analysisId: 'a-1',
  actualImpactId: 'o-1',
  truePositives: [],
  falsePositives: [],
  falseNegatives: [],
  missedArtifactCategories: [],
  missedRelationshipTypes: [],
  judgedTiers: ['required', 'likely'],
  falsePositiveBases: [],
};

const minimalOutput = {
  schemaVersion: 1,
  command: 'record-actual-impact',
  outcomeId: 'o-1',
  analysisId: 'a-1',
  recordedAt: '2026-08-06T10:00:00.000Z',
  metrics: minimalMetrics,
  historyCount: 1,
  note: 'append-only evidence',
};

const aggregate = {
  outcomeCount: 12,
  precision: { mean: 0.55, sampleSize: 10 },
  recall: { mean: 0.8, sampleSize: 7 },
  rankingQuality: { mean: 0.9, sampleSize: 6 },
  truePositiveCount: 30,
  falsePositiveCount: 25,
  falseNegativeCount: 8,
  topFalsePositiveBases: [{ value: 'transitive-structural', count: 9 }],
  topMissedArtifactCategories: [{ value: 'new-test', count: 4 }],
  adrTriggerMet: true,
  adrTriggerNote: 'Mean precision 0.55 across 10 outcomes — below the 0.6 trigger in ADR-0015.',
};

describe('record_actual_impact aggregate block (additive v1)', () => {
  it('the output accepts the block as optional — with and without', () => {
    expect(output.safeParse(minimalOutput).success).toBe(true);
    expect(output.safeParse({ ...minimalOutput, aggregate }).success).toBe(true);
  });

  it('per-metric means travel WITH their sample sizes — one is meaningless without the other', () => {
    const { precision, ...withoutSampleSize } = aggregate;
    expect(precision.sampleSize).toBe(10);
    expect(outcomeAggregateSchema.safeParse(withoutSampleSize).success).toBe(true); // means optional
    expect(
      outcomeAggregateSchema.safeParse({ ...aggregate, precision: { mean: 0.5 } }).success,
    ).toBe(false);
  });

  it('the trigger note is optional, but the verdict itself is not', () => {
    const { adrTriggerNote, ...withoutNote } = aggregate;
    expect(adrTriggerNote.length).toBeGreaterThan(0);
    expect(outcomeAggregateSchema.safeParse(withoutNote).success).toBe(true);
    const { adrTriggerMet, ...withoutVerdict } = withoutNote;
    expect(adrTriggerMet).toBe(true);
    expect(outcomeAggregateSchema.safeParse(withoutVerdict).success).toBe(false);
  });

  it('rejects unknown keys, out-of-range means, and empty frequency values', () => {
    expect(outcomeAggregateSchema.safeParse({ ...aggregate, extra: 1 }).success).toBe(false);
    expect(
      outcomeAggregateSchema.safeParse({ ...aggregate, precision: { mean: 1.2, sampleSize: 1 } })
        .success,
    ).toBe(false);
    expect(
      outcomeAggregateSchema.safeParse({
        ...aggregate,
        topFalsePositiveBases: [{ value: '', count: 1 }],
      }).success,
    ).toBe(false);
  });
});
