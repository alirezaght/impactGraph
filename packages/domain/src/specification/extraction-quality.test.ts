import { describe, expect, it } from 'vitest';

import { extractionQualityIssues, isProvisional, strategyFor } from './extraction-quality.js';

import type { ExtractionQuality } from './extraction-quality.js';

// Graduated extraction semantics (field failure: a normal design doc — Background/Goals prose —
// was sentence-split wholesale, marked PROVISIONAL, and its author told to reformat). The rule
// now: a document whose prose is mostly normative is a legitimate specification; provisional is
// reserved for documents where the classifier found mostly uncertain sentences.

describe('strategyFor', () => {
  it('reports structured when every requirement came from the author’s own list', () => {
    expect(strategyFor(3, 0, 0)).toBe('structured');
  });

  it('reports partially-structured when prose statements ride along a structured list', () => {
    expect(strategyFor(3, 1, 0)).toBe('partially-structured');
    expect(strategyFor(3, 0, 2)).toBe('partially-structured');
  });

  it('reports prose-modal when the classifier admitted normative prose statements', () => {
    expect(strategyFor(0, 4, 0)).toBe('prose-modal');
    expect(strategyFor(0, 1, 0)).toBe('prose-modal');
  });

  it('reports prose-fallback only when nothing normative was admitted', () => {
    expect(strategyFor(0, 0, 0)).toBe('prose-fallback');
    expect(strategyFor(0, 0, 5)).toBe('prose-fallback');
  });
});

describe('isProvisional', () => {
  it('is never provisional while the author declared a structured list', () => {
    expect(isProvisional(2, 0, 10)).toBe(false);
  });

  it('is NOT provisional when the prose is mostly requirement-grade modal statements', () => {
    expect(isProvisional(0, 5, 2)).toBe(false);
    expect(isProvisional(0, 4, 4)).toBe(false);
  });

  it('stays provisional when the extractor found mostly uncertain sentences', () => {
    expect(isProvisional(0, 1, 5)).toBe(true);
    expect(isProvisional(0, 0, 4)).toBe(true);
  });

  it('does not withhold readiness over a small uncertain document', () => {
    expect(isProvisional(0, 0, 3)).toBe(false);
    expect(isProvisional(0, 1, 2)).toBe(false);
  });
});

describe('extractionQualityIssues', () => {
  const quality: ExtractionQuality = {
    strategy: 'prose-modal',
    structuredRequirementCount: 0,
    proseRequirementCount: 3,
    uncertainStatementCount: 1,
    recognizedSections: ['Goals'],
    provisional: false,
    warnings: [],
  };

  it('accepts the prose-modal strategy and a counted uncertain statement', () => {
    expect(extractionQualityIssues(quality, 'q')).toEqual([]);
  });

  it('rejects a negative uncertainStatementCount', () => {
    const issues = extractionQualityIssues({ ...quality, uncertainStatementCount: -1 }, 'q');
    expect(issues.some((issue) => issue.path === 'q.uncertainStatementCount')).toBe(true);
  });
});
