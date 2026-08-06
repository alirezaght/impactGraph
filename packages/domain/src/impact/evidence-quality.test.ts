import { describe, expect, it } from 'vitest';

import { assessEvidenceQuality } from './evidence-quality.js';

import type { ShownImpactFact } from './evidence-quality.js';
import type { ImpactEvidenceType, ImpactLikelihood } from '../index.js';

// Dogfooding item 4 — the aggregate honesty signal. `counts.byLikelihood`/`byEvidenceType`
// existed but nothing interpreted them: a view where every "impact" was a fuzzy name match read
// exactly like a view anchored on structural evidence. This verdict is deterministic knowledge
// derived from stored facts (like assessCoverageSufficiency) — never model-authored.

const fact = (
  likelihood: ImpactLikelihood,
  primaryBasis: ImpactEvidenceType,
  overrides: Partial<ShownImpactFact> = {},
): ShownImpactFact => ({ likelihood, primaryBasis, hops: 0, tierCapped: false, ...overrides });

describe('assessEvidenceQuality', () => {
  it('reports evidence-backed for an empty view — nothing shown can overstate', () => {
    const verdict = assessEvidenceQuality([]);
    expect(verdict.status).toBe('evidence-backed');
    expect(verdict.reasons).toEqual([]);
    expect(verdict.counts.shownImpactCount).toBe(0);
  });

  it('reports evidence-backed when strong tiers rest on structural evidence', () => {
    const verdict = assessEvidenceQuality([
      fact('required', 'direct-structural'),
      fact('likely', 'async-event', { hops: 1 }),
      fact('possible', 'transitive-structural', { hops: 2 }),
    ]);
    expect(verdict.status).toBe('evidence-backed');
    expect(verdict.reasons).toEqual([]);
    expect(verdict.counts.strongTierStructuralCount).toBe(2);
  });

  it('reports weak when no shown impact reached required or likely', () => {
    const verdict = assessEvidenceQuality([
      fact('possible', 'transitive-structural', { hops: 2 }),
      fact('possible', 'transitive-structural', { hops: 3 }),
    ]);
    expect(verdict.status).toBe('weak');
    expect(verdict.reasons.some((reason) => reason.includes('required or likely'))).toBe(true);
  });

  it('reports weak when every strong-tier impact is a name or meaning match', () => {
    const verdict = assessEvidenceQuality([
      fact('likely', 'name-similarity', { tierCapped: true }),
      fact('likely', 'name-similarity', { tierCapped: true }),
      fact('possible', 'semantic-match'),
    ]);
    expect(verdict.status).toBe('weak');
    expect(verdict.reasons.some((reason) => reason.includes('structural evidence'))).toBe(true);
    expect(verdict.counts.strongTierCount).toBe(2);
    expect(verdict.counts.strongTierStructuralCount).toBe(0);
  });

  it('reports mixed when structural strong-tier evidence exists but a majority is fuzzy-anchored', () => {
    const verdict = assessEvidenceQuality([
      fact('required', 'direct-structural'),
      fact('likely', 'name-similarity', { tierCapped: true }),
      fact('likely', 'name-similarity', { tierCapped: true }),
    ]);
    expect(verdict.status).toBe('mixed');
    expect(verdict.reasons.some((reason) => reason.includes('fuzzy name similarity'))).toBe(true);
    expect(verdict.counts.fuzzyAnchorCount).toBe(2);
  });

  it('reports mixed when a majority of shown impacts are two or more hops out', () => {
    const verdict = assessEvidenceQuality([
      fact('required', 'direct-structural'),
      fact('possible', 'transitive-structural', { hops: 2 }),
      fact('possible', 'transitive-structural', { hops: 4 }),
    ]);
    expect(verdict.status).toBe('mixed');
    expect(verdict.reasons.some((reason) => reason.includes('propagating hops'))).toBe(true);
    expect(verdict.counts.multiHopCount).toBe(2);
  });

  it('an exact half is not a majority — thresholds are strict', () => {
    const verdict = assessEvidenceQuality([
      fact('required', 'direct-structural'),
      fact('likely', 'name-similarity', { tierCapped: true }),
    ]);
    // 1 of 2 fuzzy is not "> half"; the only reason left is the tier-cap note.
    expect(verdict.counts.fuzzyAnchorCount).toBe(1);
    expect(verdict.reasons.some((reason) => reason.includes('fuzzy name similarity'))).toBe(false);
  });

  it('mentions tier caps with a count, and caps alone read as mixed, never weak', () => {
    const verdict = assessEvidenceQuality([
      fact('required', 'direct-structural'),
      fact('required', 'external-contract'),
      fact('likely', 'name-similarity', { tierCapped: true }),
    ]);
    expect(verdict.status).toBe('mixed');
    expect(verdict.reasons.some((reason) => reason.includes('tier was capped'))).toBe(true);
    expect(verdict.counts.tierCappedCount).toBe(1);
  });

  it('never lets a weak verdict pass silently — weak always carries a reason', () => {
    const weak = assessEvidenceQuality([fact('possible', 'lexical-only')]);
    expect(weak.status).toBe('weak');
    expect(weak.reasons.length).toBeGreaterThan(0);
  });
});
