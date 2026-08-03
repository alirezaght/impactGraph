import { createFakeModelProvider } from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { createNullProvider, createSpecificationExtractor } from './index.js';

const validOutput = {
  requirements: [
    {
      statement: 'Expired deals must be hidden from search results.',
      type: 'functional',
      concepts: ['deal'],
      actors: [],
      sourceExcerpt: 'Expired deals must be hidden',
    },
  ],
  actors: ['M&A advisor'],
  constraints: [],
  openQuestions: [],
};

const input = { title: 'Deal visibility', rawText: 'Expired deals must be hidden from search.' };

describe('specification extractor over ModelProviderPort (Story 5.2/5.3)', () => {
  it('returns schema-validated extraction and marks the spec text as untrusted data', async () => {
    const provider = createFakeModelProvider([validOutput]);
    const result = await createSpecificationExtractor(provider).extract(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requirements[0]?.statement).toContain('Expired deals');
    }
    expect(provider.requests[0]?.systemPrompt).toContain('UNTRUSTED DATA');
    expect(provider.requests[0]?.prompt).toContain('<spec>');
  });

  it('rejects invalid model output — retried once, then a typed error, never used (§34, §47.8)', async () => {
    const invalid = { requirements: [{ statement: '', type: 'wish' }] };
    const provider = createFakeModelProvider([invalid, invalid]);
    const result = await createSpecificationExtractor(provider).extract(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-output');
    }
    expect(provider.requests).toHaveLength(2);
  });

  it('recovers when the retry produces valid output', async () => {
    const provider = createFakeModelProvider([{ nonsense: true }, validOutput]);
    const result = await createSpecificationExtractor(provider).extract(input);
    expect(result.ok).toBe(true);
  });

  it('the null provider reports not-configured without retrying (deterministic-only, §8)', async () => {
    const result = await createSpecificationExtractor(createNullProvider()).extract(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-configured');
    }
  });
});
