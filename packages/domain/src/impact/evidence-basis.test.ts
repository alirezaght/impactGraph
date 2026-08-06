import { describe, expect, it } from 'vitest';

import {
  capLikelihood,
  evidenceStrengthRank,
  IMPACT_EVIDENCE_TYPES,
  isImpactEvidenceType,
  primaryEvidenceType,
  STRUCTURAL_EVIDENCE_TYPES,
} from './evidence-basis.js';

// Dogfooding item 4 — a deterministic fuzzy name match is its own kind of evidence. It used to be
// filed as `direct-structural`, which let a 0.6-coverage name resemblance claim `required` with no
// cap and no audit trail. These tests pin the vocabulary entry, its strength position, and its
// tier ceiling.

describe('name-similarity evidence type', () => {
  it('is part of the closed vocabulary', () => {
    expect(IMPACT_EVIDENCE_TYPES).toContain('name-similarity');
    expect(isImpactEvidenceType('name-similarity')).toBe(true);
  });

  it('ranks below every structural basis — a name resemblance establishes no relationship', () => {
    for (const structural of [
      'direct-structural',
      'async-event',
      'external-contract',
      'field-data-flow',
      'configuration-asset',
      'transitive-structural',
    ] as const) {
      expect(evidenceStrengthRank('name-similarity')).toBeGreaterThan(
        evidenceStrengthRank(structural),
      );
    }
  });

  it('ranks above semantic-match — deterministic token alignment beats meaning inference', () => {
    expect(evidenceStrengthRank('name-similarity')).toBeLessThan(
      evidenceStrengthRank('semantic-match'),
    );
    expect(evidenceStrengthRank('name-similarity')).toBeLessThan(
      evidenceStrengthRank('lexical-only'),
    );
  });

  it('caps the tier at likely — a guessed component is never an obligation', () => {
    expect(capLikelihood('required', ['name-similarity'])).toBe('likely');
    expect(capLikelihood('likely', ['name-similarity'])).toBe('likely');
    expect(capLikelihood('possible', ['name-similarity'])).toBe('possible');
  });

  it('is out-ranked by a corroborating structural basis', () => {
    expect(primaryEvidenceType(['name-similarity', 'direct-structural'])).toBe('direct-structural');
    expect(capLikelihood('required', ['name-similarity', 'direct-structural'])).toBe('required');
  });

  it('stays visible in default views — unlike lexical-only it can reach likely', () => {
    expect(STRUCTURAL_EVIDENCE_TYPES).toContain('name-similarity');
    expect(STRUCTURAL_EVIDENCE_TYPES).not.toContain('lexical-only');
  });
});
