import { DEFAULT_JUDGED_TIERS } from './measure.js';

import type { EvaluationMetrics } from './actual-impact.js';

/**
 * Accuracy across EVERY recorded outcome (dogfooding item 8: "record actual implementation outcomes
 * and measure precision, recall, ranking quality across them").
 *
 * Derived at answer time from the append-only records and never persisted — a stored aggregate
 * would be stale by the next outcome, for the same reason index freshness is computed at read time.
 * Evaluation data, not architectural fact: nothing here feeds back into ranking, confidence, or
 * confirmed repository knowledge. The one conclusion it draws (`adrTriggerMet`) is a statement for
 * a human, never an automated action.
 */

/** A mean over the records that HAVE the figure — undefined ratios are excluded, not zeroed. */
export interface MetricAggregate {
  readonly mean: number;
  /** How many outcomes the mean is over. A mean of 0.9 over 2 records is not a track record. */
  readonly sampleSize: number;
}

export interface FrequencyCount {
  readonly value: string;
  /** Number of OUTCOMES in which the value appeared (each record stores it deduplicated). */
  readonly count: number;
}

export interface OutcomeAggregate {
  readonly outcomeCount: number;
  readonly precision?: MetricAggregate;
  readonly recall?: MetricAggregate;
  readonly rankingQuality?: MetricAggregate;
  readonly truePositiveCount: number;
  readonly falsePositiveCount: number;
  readonly falseNegativeCount: number;
  /** The recurring noise sources, strongest first — which rule to look at, over time. */
  readonly topFalsePositiveBases: readonly FrequencyCount[];
  readonly topMissedArtifactCategories: readonly FrequencyCount[];
  /** ADR-0015's revisit trigger, evaluated: ≥ 10 judged-tier outcomes with mean precision < 0.6. */
  readonly adrTriggerMet: boolean;
  readonly adrTriggerNote?: string;
}

const TOP_LIMIT = 3;
const ADR_TRIGGER_MIN_OUTCOMES = 10;
const ADR_TRIGGER_PRECISION = 0.6;

const round = (value: number): number => Math.round(value * 100) / 100;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const aggregateOf = (
  records: readonly EvaluationMetrics[],
  pick: (record: EvaluationMetrics) => number | undefined,
): MetricAggregate | undefined => {
  const present = records.map(pick).filter((value): value is number => value !== undefined);
  return present.length === 0
    ? undefined
    : { mean: round(mean(present)), sampleSize: present.length };
};

const topCounts = (values: readonly string[]): readonly FrequencyCount[] => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, TOP_LIMIT);
};

/**
 * The ADR trigger is specifically about precision at required/likely, so only outcomes judged at
 * (at least) those tiers count toward its sample — a record judged at another tier set measures
 * something else.
 */
const adrTrigger = (
  records: readonly EvaluationMetrics[],
): { readonly adrTriggerMet: boolean; readonly adrTriggerNote?: string } => {
  const judged = records
    .filter((record) => DEFAULT_JUDGED_TIERS.every((tier) => record.judgedTiers.includes(tier)))
    .map((record) => record.precision)
    .filter((value): value is number => value !== undefined);
  // Compared on the ROUNDED mean, so the figure in the note is the figure that was judged —
  // and ten outcomes at exactly 0.6 do not fire the trigger on floating-point dust.
  const judgedMean = judged.length === 0 ? undefined : round(mean(judged));
  if (
    judged.length < ADR_TRIGGER_MIN_OUTCOMES ||
    judgedMean === undefined ||
    judgedMean >= ADR_TRIGGER_PRECISION
  ) {
    return { adrTriggerMet: false };
  }
  return {
    adrTriggerMet: true,
    adrTriggerNote:
      `Mean precision at the required/likely tiers is ${String(judgedMean)} across ` +
      `${String(judged.length)} recorded outcomes — below the 0.6 revisit trigger in ADR-0015, ` +
      'which says the evidence-basis vocabulary and tier ceilings need splitting further. ' +
      'A fact for human review; nothing was changed automatically.',
  };
};

const sumOf = (
  records: readonly EvaluationMetrics[],
  pick: (record: EvaluationMetrics) => readonly string[],
): number => records.reduce((sum, record) => sum + pick(record).length, 0);

export const aggregateOutcomes = (records: readonly EvaluationMetrics[]): OutcomeAggregate => {
  const precision = aggregateOf(records, (record) => record.precision);
  const recall = aggregateOf(records, (record) => record.recall);
  const rankingQuality = aggregateOf(records, (record) => record.rankingQuality);
  return {
    outcomeCount: records.length,
    ...(precision === undefined ? {} : { precision }),
    ...(recall === undefined ? {} : { recall }),
    ...(rankingQuality === undefined ? {} : { rankingQuality }),
    truePositiveCount: sumOf(records, (record) => record.truePositives),
    falsePositiveCount: sumOf(records, (record) => record.falsePositives),
    falseNegativeCount: sumOf(records, (record) => record.falseNegatives),
    topFalsePositiveBases: topCounts(records.flatMap((record) => record.falsePositiveBases)),
    topMissedArtifactCategories: topCounts(
      records.flatMap((record) => record.missedArtifactCategories),
    ),
    ...adrTrigger(records),
  };
};
