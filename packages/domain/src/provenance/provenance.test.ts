import { describe, expect, it } from 'vitest';

import { isProvenance, knowledgeCategoryOf, PROVENANCE_VALUES } from '../index.js';

describe('Provenance (PRD §12.3)', () => {
  it('models exactly the seven PRD provenance values', () => {
    expect([...PROVENANCE_VALUES]).toEqual([
      'static-analysis',
      'configuration',
      'human-confirmed',
      'llm-inferred',
      'git-history',
      'framework-convention',
      'runtime-observation',
    ]);
  });

  it('recognises valid provenance values', () => {
    for (const value of PROVENANCE_VALUES) {
      expect(isProvenance(value)).toBe(true);
    }
  });

  it('rejects unknown or non-string values', () => {
    expect(isProvenance('ai')).toBe(false);
    expect(isProvenance('STATIC-ANALYSIS')).toBe(false);
    expect(isProvenance(undefined)).toBe(false);
    expect(isProvenance(42)).toBe(false);
  });
});

describe('knowledgeCategoryOf (PRD §3, ADR-0002)', () => {
  it('maps deterministic provenance values to the deterministic category', () => {
    expect(knowledgeCategoryOf('static-analysis')).toBe('deterministic');
    expect(knowledgeCategoryOf('configuration')).toBe('deterministic');
    expect(knowledgeCategoryOf('git-history')).toBe('deterministic');
    expect(knowledgeCategoryOf('framework-convention')).toBe('deterministic');
  });

  it('maps llm-inferred to ai-inferred and human-confirmed to human-confirmed', () => {
    expect(knowledgeCategoryOf('llm-inferred')).toBe('ai-inferred');
    expect(knowledgeCategoryOf('human-confirmed')).toBe('human-confirmed');
  });

  it('maps runtime-observation to the reserved category', () => {
    expect(knowledgeCategoryOf('runtime-observation')).toBe('reserved');
  });
});
