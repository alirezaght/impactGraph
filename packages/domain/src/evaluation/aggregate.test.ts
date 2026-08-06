import { describe, expect, it } from 'vitest';

import { aggregateOutcomes } from './aggregate.js';

import type { EvaluationMetrics } from './actual-impact.js';

// Dogfooding item 8: the recorded outcomes were write-only in practice — nothing read them back, so
// "how is prediction quality trending" and ADR-0015's ten-outcome revisit trigger could not be
// answered. This aggregation is derived at answer time from the append-only records and never
// persisted (a persisted aggregate would be stale by the next record, same rationale as freshness).

const metrics = (overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics => ({
  analysisId: 'analysis-1',
  actualImpactId: 'outcome-1',
  truePositives: [],
  falsePositives: [],
  falseNegatives: [],
  missedArtifactCategories: [],
  missedRelationshipTypes: [],
  judgedTiers: ['required', 'likely'],
  falsePositiveBases: [],
  ...overrides,
});

describe('aggregateOutcomes — means over the records that HAVE each figure', () => {
  it('reports an empty aggregate honestly: zero outcomes, no means, no trigger', () => {
    const aggregate = aggregateOutcomes([]);
    expect(aggregate.outcomeCount).toBe(0);
    expect(aggregate.precision).toBeUndefined();
    expect(aggregate.recall).toBeUndefined();
    expect(aggregate.rankingQuality).toBeUndefined();
    expect(aggregate.truePositiveCount).toBe(0);
    expect(aggregate.topFalsePositiveBases).toEqual([]);
    expect(aggregate.adrTriggerMet).toBe(false);
  });

  it('a single record aggregates to itself, with sample size 1 on every present figure', () => {
    const aggregate = aggregateOutcomes([
      metrics({ precision: 0.75, recall: 0.5, rankingQuality: 1 }),
    ]);
    expect(aggregate.outcomeCount).toBe(1);
    expect(aggregate.precision).toEqual({ mean: 0.75, sampleSize: 1 });
    expect(aggregate.recall).toEqual({ mean: 0.5, sampleSize: 1 });
    expect(aggregate.rankingQuality).toEqual({ mean: 1, sampleSize: 1 });
  });

  it('excludes undefined ratios from the mean AND from the sample size — undefined is not zero', () => {
    const aggregate = aggregateOutcomes([
      metrics({ precision: 1, recall: 0.4 }),
      metrics({ precision: 0.5 }), // recall could not be computed: not a 0 in the recall mean
      metrics({}), // nothing judged at all: contributes to outcomeCount only
    ]);
    expect(aggregate.outcomeCount).toBe(3);
    expect(aggregate.precision).toEqual({ mean: 0.75, sampleSize: 2 });
    expect(aggregate.recall).toEqual({ mean: 0.4, sampleSize: 1 });
    expect(aggregate.rankingQuality).toBeUndefined();
  });

  it('totals true/false positives and false negatives across every record', () => {
    const aggregate = aggregateOutcomes([
      metrics({ truePositives: ['a.ts', 'b.ts'], falsePositives: ['c.ts'] }),
      metrics({ truePositives: ['a.ts'], falseNegatives: ['d.ts', 'e.ts'] }),
    ]);
    expect(aggregate.truePositiveCount).toBe(3);
    expect(aggregate.falsePositiveCount).toBe(1);
    expect(aggregate.falseNegativeCount).toBe(2);
  });

  it('ranks the recurring false-positive bases and missed categories by outcome frequency', () => {
    const aggregate = aggregateOutcomes([
      metrics({
        falsePositiveBases: ['transitive-structural', 'name-similarity'],
        missedArtifactCategories: ['new-test'],
      }),
      metrics({
        falsePositiveBases: ['transitive-structural'],
        missedArtifactCategories: ['new-test', 'new-migration'],
      }),
      metrics({ falsePositiveBases: ['transitive-structural', 'async-event', 'lexical-only'] }),
    ]);
    // Count-descending, ties alphabetical, capped — the "which rule to look at" view over time.
    expect(aggregate.topFalsePositiveBases).toEqual([
      { value: 'transitive-structural', count: 3 },
      { value: 'async-event', count: 1 },
      { value: 'lexical-only', count: 1 },
    ]);
    expect(aggregate.topMissedArtifactCategories).toEqual([
      { value: 'new-test', count: 2 },
      { value: 'new-migration', count: 1 },
    ]);
  });
});

describe('aggregateOutcomes — the ADR-0015 revisit trigger, stated as a fact', () => {
  const lowPrecision = (count: number): EvaluationMetrics[] =>
    Array.from({ length: count }, (_, index) =>
      metrics({ actualImpactId: `outcome-${String(index)}`, precision: 0.5 }),
    );

  it('fires at ten judged-tier outcomes with mean precision below 0.6, and says why', () => {
    const aggregate = aggregateOutcomes(lowPrecision(10));
    expect(aggregate.adrTriggerMet).toBe(true);
    expect(aggregate.adrTriggerNote).toContain('ADR-0015');
    expect(aggregate.adrTriggerNote).toContain('0.6');
    expect(aggregate.adrTriggerNote).toContain('10');
  });

  it('does not fire below ten outcomes, however low the mean', () => {
    const aggregate = aggregateOutcomes(lowPrecision(9));
    expect(aggregate.adrTriggerMet).toBe(false);
    expect(aggregate.adrTriggerNote).toBeUndefined();
  });

  it('does not fire at mean 0.6 — the trigger is "stays BELOW 0.6"', () => {
    const aggregate = aggregateOutcomes(
      lowPrecision(10).map((record) => ({ ...record, precision: 0.6 })),
    );
    expect(aggregate.adrTriggerMet).toBe(false);
  });

  it('counts only outcomes judged at the required/likely tiers toward the trigger', () => {
    // Ten low-precision outcomes, but one was judged at a different tier set: the ADR's trigger is
    // about precision at required/likely, so that record is not part of its sample.
    const records = [
      ...lowPrecision(9),
      metrics({ actualImpactId: 'outcome-possible', precision: 0, judgedTiers: ['possible'] }),
    ];
    const aggregate = aggregateOutcomes(records);
    expect(aggregate.precision?.sampleSize).toBe(10);
    expect(aggregate.adrTriggerMet).toBe(false);
  });
});
