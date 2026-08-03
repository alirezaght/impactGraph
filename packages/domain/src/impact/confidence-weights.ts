import { createConfidenceScore } from '../provenance/confidence.js';

import type { Result } from '../errors/result.js';
import type { ValidationError } from '../errors/validation.js';
import type { ConfidenceScore, ConfidenceSignalType } from '../provenance/confidence.js';

// PRD §14 — the weighted-signal confidence engine's weight table. Weights live in domain code
// under test; stored records keep the contributions they were computed with, so old scores stay
// explainable after any re-weighting (provenance-model.md).

export const IMPACT_SIGNAL_WEIGHTS: Readonly<Partial<Record<ConfidenceSignalType, number>>> = {
  'exact-concept-to-symbol-match': 0.9,
  'human-confirmed-mapping': 0.9,
  'semantic-concept-match': 0.5,
  'direct-import': 0.1,
  'direct-function-call': 0.1,
  'direct-data-access': 0.1,
  'api-ownership': 0.1,
  'event-relationship': 0.05,
  'shared-bounded-context': 0.05,
  'framework-convention': 0.05,
  'historical-co-change': 0.1,
  'test-association': 0.05,
  'documentation-match': 0.05,
  // Penalties (must stay <= 0 — enforced by the ConfidenceScore factory):
  'graph-distance': -0.25,
  ambiguity: -0.15,
  'conflicting-evidence': -0.2,
  'unsupported-inference': -0.3,
  'test-only-match': -0.25,
};

/**
 * §18.4/§26 proposed relationships score on the SAME signal vocabulary with their own weights.
 * A separate table because the evidence is of a different kind: an impact is anchored by a
 * concept match on an existing component, while a proposal is anchored by the §12.2 vocabulary
 * rule that fixes the relationship's direction, discounted because the footprint pairing the
 * two components came from a model-authored interpretation. Signal MEANINGS are unchanged.
 */
export const PROPOSED_RELATIONSHIP_SIGNAL_WEIGHTS: Readonly<
  Partial<Record<ConfidenceSignalType, number>>
> = {
  'framework-convention': 0.45,
  'event-relationship': 0.3,
  'historical-co-change': 0.1,
  // Penalties:
  'graph-distance': -0.1,
  'unsupported-inference': -0.25,
};

export interface ImpactSignalInput {
  readonly type: ConfidenceSignalType;
  readonly description?: string;
}

const clamp = (value: number): number => Math.min(0.99, Math.max(0.05, value));

const aggregate = (
  signals: readonly ImpactSignalInput[],
  weights: Readonly<Partial<Record<ConfidenceSignalType, number>>>,
): Result<ConfidenceScore, ValidationError> => {
  const contributions = signals.map((signal) => ({
    type: signal.type,
    contribution: weights[signal.type] ?? 0,
    ...(signal.description === undefined ? {} : { description: signal.description }),
  }));
  const total = contributions.reduce((sum, signal) => sum + signal.contribution, 0);
  const value = Math.round(clamp(total) * 100) / 100;
  return createConfidenceScore(value, contributions);
};

/**
 * Deterministic aggregation: sum of weighted contributions, clamped to (0, 1), rounded to two
 * decimals. Reproducible from the stored signals alone — never a model-authored number.
 */
export const computeImpactConfidence = (
  signals: readonly ImpactSignalInput[],
): Result<ConfidenceScore, ValidationError> => aggregate(signals, IMPACT_SIGNAL_WEIGHTS);

/** The same aggregation over the proposal weight table (§18.4). */
export const computeProposedRelationshipConfidence = (
  signals: readonly ImpactSignalInput[],
): Result<ConfidenceScore, ValidationError> =>
  aggregate(signals, PROPOSED_RELATIONSHIP_SIGNAL_WEIGHTS);
