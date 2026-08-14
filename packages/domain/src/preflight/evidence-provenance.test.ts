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

describe('the completeness statement', () => {
  it('states discovery, confirmation, and weak counts in one deterministic sentence', () => {
    const independence = summariseIndependence([
      'INDEPENDENTLY_DISCOVERED',
      'INDEPENDENTLY_DISCOVERED',
      'CONSTRAINT_DERIVED',
      'STRUCTURALLY_INFERRED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'USER_SUPPLIED',
      'WEAK_LEXICAL',
      'WEAK_LEXICAL',
      'TRANSITIVE',
    ]);
    expect(independence.statement).toBe(
      '4 of 12 impacts were independently discovered; 5 confirm components the specification itself named; 3 rest on weak lexical or transitive matches.',
    );
  });

  it('says outright when nothing was discovered — the all-echo case the field exists for', () => {
    const independence = summariseIndependence(['USER_SUPPLIED', 'USER_SUPPLIED']);
    expect(independence.statement).toBe(
      '0 of 2 impacts were independently discovered; 2 confirm components the specification itself named.',
    );
  });

  it('reads absent provenance as weak, and says so in the statement', () => {
    const independence = summariseIndependence([undefined, 'INDEPENDENTLY_DISCOVERED']);
    expect(independence.statement).toBe(
      '1 of 2 impacts were independently discovered; 1 rest on weak lexical or transitive matches.',
    );
  });

  it('has an honest statement for an empty analysis', () => {
    expect(summariseIndependence([]).statement).toBe(
      'No impacts were assessed for evidence independence.',
    );
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
