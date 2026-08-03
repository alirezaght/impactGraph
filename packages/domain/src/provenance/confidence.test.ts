import { describe, expect, it } from 'vitest';

import { CONFIDENCE_SIGNAL_TYPES, createConfidenceScore, PENALTY_SIGNAL_TYPES } from '../index.js';

const directImport = { type: 'direct-import', contribution: 0.4 };

describe('ConfidenceScore (PRD §14)', () => {
  it('lists the PRD §14 signal vocabulary, with the four penalties marked', () => {
    expect(CONFIDENCE_SIGNAL_TYPES).toContain('exact-concept-to-symbol-match');
    expect(CONFIDENCE_SIGNAL_TYPES).toContain('historical-co-change');
    expect(CONFIDENCE_SIGNAL_TYPES).toContain('human-confirmed-mapping');
    expect(CONFIDENCE_SIGNAL_TYPES).toContain('direct-observation');
    expect(CONFIDENCE_SIGNAL_TYPES).toHaveLength(18);
    expect([...PENALTY_SIGNAL_TYPES]).toEqual([
      'graph-distance',
      'ambiguity',
      'conflicting-evidence',
      'unsupported-inference',
    ]);
  });

  it('constructs from a value in 0..1 and at least one signal', () => {
    const result = createConfidenceScore(0.88, [
      { type: 'exact-concept-to-symbol-match', contribution: 0.5 },
      { type: 'graph-distance', contribution: -0.1 },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(0.88);
      expect(result.value.signals).toHaveLength(2);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.signals)).toBe(true);
    }
  });

  it('rejects a bare number with no contributing signals', () => {
    const result = createConfidenceScore(0.9, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'missing-signals')).toBe(true);
    }
  });

  it('rejects values outside 0..1 and non-finite values', () => {
    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createConfidenceScore(value, [directImport]);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown signal types', () => {
    const result = createConfidenceScore(0.5, [{ type: 'gut-feeling', contribution: 0.5 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'unknown-signal')).toBe(true);
    }
  });

  it('rejects penalty signals with positive contributions and boosts with negative ones', () => {
    const badPenalty = createConfidenceScore(0.5, [{ type: 'ambiguity', contribution: 0.2 }]);
    expect(badPenalty.ok).toBe(false);

    const badBoost = createConfidenceScore(0.5, [{ type: 'direct-import', contribution: -0.2 }]);
    expect(badBoost.ok).toBe(false);
  });

  it('allows zero contributions on either side', () => {
    const result = createConfidenceScore(0.5, [
      { type: 'ambiguity', contribution: 0 },
      { type: 'direct-import', contribution: 0 },
    ]);
    expect(result.ok).toBe(true);
  });
});
