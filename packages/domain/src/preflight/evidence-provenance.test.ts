import { describe, expect, it } from 'vitest';

import {
  independenceWeight,
  isIndependent,
  provenanceLabel,
  provenanceOf,
  summariseIndependence,
} from './evidence-provenance.js';
import { classifyUnmatchedRequirement } from './requirement-classification.js';

import type { ClassificationSignals } from './requirement-classification.js';

describe('evidence provenance', () => {
  it('treats a specification echo as confirmation, not discovery', () => {
    expect(provenanceLabel('USER_SUPPLIED')).toBe('confirmation');
    expect(provenanceLabel('INDEPENDENTLY_DISCOVERED')).toBe('discovery');
    expect(isIndependent('USER_SUPPLIED')).toBe(false);
  });

  it('weights an echo far below an independent discovery', () => {
    expect(independenceWeight('USER_SUPPLIED')).toBeLessThan(
      independenceWeight('INDEPENDENTLY_DISCOVERED') / 5,
    );
  });

  it('reads a missing provenance as the weakest interpretation', () => {
    expect(provenanceOf(undefined)).toBe('WEAK_LEXICAL');
    expect(isIndependent(provenanceOf(undefined))).toBe(false);
  });

  it('does not let four spec echoes look like four discoveries', () => {
    const echoes = summariseIndependence([
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
    ]);
    const discoveries = summariseIndependence([
      'INDEPENDENTLY_DISCOVERED',
      'INDEPENDENTLY_DISCOVERED',
      'INDEPENDENTLY_DISCOVERED',
      'INDEPENDENTLY_DISCOVERED',
    ]);
    expect(echoes.totalCount).toBe(discoveries.totalCount);
    expect(echoes.independentCount).toBe(0);
    expect(echoes.confirmationCount).toBe(4);
    expect(echoes.weightedIndependence).toBeLessThan(discoveries.weightedIndependence / 5);
  });

  it('counts constraint- and runtime-derived evidence as independent', () => {
    expect(isIndependent('CONSTRAINT_DERIVED')).toBe(true);
    expect(isIndependent('RUNTIME_DERIVED')).toBe(true);
  });
});

const signals = (overrides: Partial<ClassificationSignals> = {}): ClassificationSignals => ({
  hasInvalidSymbolAssumption: false,
  touchesUnindexedRepository: false,
  touchesIndexingGap: false,
  usesCreationLanguage: false,
  referencesExternalBoundary: false,
  hasAmbiguousConcept: false,
  siblingSurfaceIndexed: false,
  ...overrides,
});

describe('classifyUnmatchedRequirement', () => {
  it('classifies a new localization namespace as NEW_SURFACE', () => {
    const result = classifyUnmatchedRequirement(
      'R9',
      signals({ usesCreationLanguage: true, siblingSurfaceIndexed: true }),
    );
    expect(result.classification).toBe('NEW_SURFACE');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('classifies a contract owned by an unindexed repository as COVERAGE_GAP, not NEW_SURFACE', () => {
    const result = classifyUnmatchedRequirement(
      'R10',
      signals({ usesCreationLanguage: true, touchesUnindexedRepository: true }),
    );
    expect(result.classification).toBe('COVERAGE_GAP');
  });

  it('lets coverage outrank an apparent invalid assumption', () => {
    const result = classifyUnmatchedRequirement(
      'R4',
      signals({ hasInvalidSymbolAssumption: true, touchesIndexingGap: true }),
    );
    expect(result.classification).toBe('COVERAGE_GAP');
    expect(result.rationale).toContain('proves nothing');
  });

  it('classifies a missing enum member as INVALID_ASSUMPTION', () => {
    const result = classifyUnmatchedRequirement(
      'R4',
      signals({ hasInvalidSymbolAssumption: true }),
    );
    expect(result.classification).toBe('INVALID_ASSUMPTION');
  });

  it('falls back to NO_EVIDENCE rather than guessing', () => {
    const result = classifyUnmatchedRequirement('R7', signals());
    expect(result.classification).toBe('NO_EVIDENCE');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});
