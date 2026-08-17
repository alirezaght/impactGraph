import { describe, expect, it } from 'vitest';

import { CONFIDENCE_SIGNAL_TYPES } from '../provenance/confidence.js';

import { computeImpactConfidence, IMPACT_SIGNAL_WEIGHTS } from './confidence-weights.js';

// "Required must mean strong": identifier-grade anchors keep the 0.9 exact-match signal; a
// container named in prose and a bare filename are weaker claims and carry their own, weaker
// signals so the resulting score stays below the review threshold and stays explainable.

describe('anchor-strength confidence signals', () => {
  it('keeps the exact identifier match at 0.9', () => {
    expect(IMPACT_SIGNAL_WEIGHTS['exact-concept-to-symbol-match']).toBe(0.9);
  });

  it.each(['container-name-match', 'basename-file-match'] as const)(
    'registers %s as a weaker positive signal (~0.4-0.5)',
    (type) => {
      expect(CONFIDENCE_SIGNAL_TYPES).toContain(type);
      const weight = IMPACT_SIGNAL_WEIGHTS[type];
      expect(weight).toBeDefined();
      expect(weight).toBeGreaterThanOrEqual(0.4);
      expect(weight).toBeLessThanOrEqual(0.5);
    },
  );

  it('scores a lone container-name anchor below 0.6', () => {
    const score = computeImpactConfidence([
      { type: 'container-name-match', description: "concept 'ImpactGraph' names a package" },
    ]);
    expect(score.ok).toBe(true);
    if (score.ok) {
      expect(score.value.value).toBeLessThan(0.6);
      expect(score.value.signals[0]?.type).toBe('container-name-match');
    }
  });
});
