import { describe, expect, it } from 'vitest';

import { architecturalStemOf, coversArchitecturalStem } from './architectural-stem.js';

// ADR-0016 — the stem rule is "cover the whole stem", not "share a token". These are the
// canonical accept/reject pairs; the matcher-level behaviour (ambiguity, test suppression,
// mechanism) is covered in concept-matching.test.ts.

const tokens = (value: string): readonly string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

describe('architecturalStemOf', () => {
  it('strips a single trailing architectural suffix token', () => {
    expect(architecturalStemOf(tokens('DealsController'))).toEqual(['deals']);
  });

  it('strips stacked trailing suffix tokens', () => {
    expect(architecturalStemOf(tokens('DealServiceFactory'))).toEqual(['deal']);
  });

  it('strips nothing when the trailing token is not a listed suffix', () => {
    expect(architecturalStemOf(tokens('SecretStorage'))).toEqual(['secret', 'storage']);
  });

  it('leaves an all-suffix name with no stem', () => {
    expect(architecturalStemOf(tokens('Controller'))).toEqual([]);
  });
});

describe('coversArchitecturalStem', () => {
  const covers = (concept: string, name: string): boolean =>
    coversArchitecturalStem(tokens(concept), tokens(name));

  it('accepts a concept that covers the whole stem of a conventionally-suffixed name', () => {
    expect(covers('deals', 'DealsController')).toBe(true);
    expect(covers('deal', 'DealRepository')).toBe(true);
    expect(covers('deal', 'DealServiceFactory')).toBe(true);
  });

  it('rejects a concept that covers only the suffix — no stem token added', () => {
    expect(covers('service', 'DealService')).toBe(false);
    expect(covers('storage', 'SecretStore')).toBe(false);
  });

  it('rejects when no suffix was stripped — the ordinary similarity rule governs', () => {
    expect(covers('storage', 'SecretStorage')).toBe(false);
    expect(covers('secret', 'SecretStorage')).toBe(false);
  });

  it('rejects a concept that leaves part of the stem uncovered', () => {
    expect(covers('deal', 'DealEventPublisherService')).toBe(false);
    expect(covers('deals', 'ArchivedDealsController')).toBe(false);
  });

  it('rejects a concept asserting tokens the component name lacks', () => {
    expect(covers('user deals', 'DealsController')).toBe(false);
  });

  it('rejects singular/plural drift — stem equality is exact', () => {
    expect(covers('deals', 'DealController')).toBe(false);
  });

  it('treats a word the same however it is cased — characters, not token counts', () => {
    // CamelCase splits "TypeScript" into two tokens where kebab-case keeps one; joined
    // characters make the two spellings of the same stem behave identically.
    expect(covers('TypeScript', 'TypeScriptAdapter')).toBe(true);
    expect(covers('TypeScript', 'typescript-adapter')).toBe(true);
    expect(covers('typescript', 'TypeScriptAdapter')).toBe(true);
  });

  it('rejects reordered tokens — the concept must be the stem, not an anagram of it', () => {
    expect(covers('provider model', 'ModelProvider')).toBe(false);
  });

  it('rejects an all-suffix name — there is no stem to claim', () => {
    expect(covers('controller', 'Controller')).toBe(false);
  });

  it('rejects an empty concept', () => {
    expect(coversArchitecturalStem([], tokens('DealsController'))).toBe(false);
  });
});
