import { describe, expect, it } from 'vitest';

import {
  classifyUnresolvedSurface,
  conceptShapeOf,
  isPrimarySurface,
  unresolvedSurfaceLabel,
} from './unresolved-surface.js';

import type { UnresolvedSurfaceSignals } from './unresolved-surface.js';

const signals = (overrides: Partial<UnresolvedSurfaceSignals> = {}): UnresolvedSurfaceSignals => ({
  concept: '/threshold-eval/export',
  requirementIds: ['R1'],
  usesCreationLanguage: false,
  referencesExternalBoundary: false,
  withinCoverageGap: false,
  siblingSurfaceIndexed: false,
  nearestExisting: [],
  ...overrides,
});

describe('conceptShapeOf', () => {
  it('separates routes, paths, identifiers and prose terms', () => {
    expect(conceptShapeOf('/threshold-eval/export')).toBe('route');
    expect(conceptShapeOf('src/jobs/export.ts')).toBe('path');
    expect(conceptShapeOf('ExportJob')).toBe('identifier');
    expect(conceptShapeOf('export')).toBe('term');
  });
});

describe('classifyUnresolvedSurface', () => {
  it('reads creation language as new construction', () => {
    const surface = classifyUnresolvedSurface(signals({ usesCreationLanguage: true }));
    expect(surface.kind).toBe('new-surface');
    expect(unresolvedSurfaceLabel(surface)).toBe(
      'NEW / UNRESOLVED SURFACE: /threshold-eval/export',
    );
  });

  it('reads an absent route beside indexed siblings as new construction', () => {
    expect(classifyUnresolvedSurface(signals({ siblingSurfaceIndexed: true })).kind).toBe(
      'new-surface',
    );
  });

  it('lets a coverage gap outrank every other reading', () => {
    const surface = classifyUnresolvedSurface(
      signals({ withinCoverageGap: true, usesCreationLanguage: true }),
    );
    expect(surface.kind).toBe('coverage-gap');
    expect(surface.alternativeKinds).toContain('new-surface');
  });

  it('keeps every reading open when nothing is established', () => {
    const surface = classifyUnresolvedSurface(signals());
    expect(surface.kind).toBe('insufficient-evidence');
    expect(surface.alternativeKinds).toEqual([
      'new-surface',
      'external-dependency',
      'coverage-gap',
      'terminology-mismatch',
    ]);
    expect(surface.confidence).toBeLessThan(0.5);
  });

  it('reports near-misses as naming evidence rather than as impacts', () => {
    const surface = classifyUnresolvedSurface(
      signals({ nearestExisting: ['exportJob', 'ExportController'] }),
    );
    expect(surface.kind).toBe('terminology-mismatch');
    expect(surface.nearestExisting).toEqual(['exportJob', 'ExportController']);
  });

  it('bounds the near-miss list', () => {
    const surface = classifyUnresolvedSurface(
      signals({ nearestExisting: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    );
    expect(surface.nearestExisting).toHaveLength(5);
  });
});

describe('isPrimarySurface', () => {
  it('promotes written commitments and demotes bare vocabulary', () => {
    expect(isPrimarySurface(classifyUnresolvedSurface(signals()))).toBe(true);
    expect(isPrimarySurface(classifyUnresolvedSurface(signals({ concept: 'throughput' })))).toBe(
      false,
    );
  });

  /**
   * Creation language is a fact about the SENTENCE, not about this term, so it does not by itself
   * make a prose word an absent commitment. A live run turned 37 "new surfaces" into a list of
   * adjectives — "first-class", "opt-in", "fail-closed" — because it did.
   */
  it('does not turn a prose word into new surface just because the sentence says "add"', () => {
    const surface = classifyUnresolvedSurface(
      signals({ concept: 'throughput', usesCreationLanguage: true }),
    );
    expect(surface.kind).not.toBe('new-surface');
    expect(isPrimarySurface(surface)).toBe(false);
  });

  it('treats a phrase as prose however much punctuation it carries', () => {
    expect(conceptShapeOf('configures service')).toBe('term');
    expect(conceptShapeOf('shell / Python')).toBe('term');
  });
});
