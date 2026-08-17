// Contract test for the AI extraction response DTO. The `origin` field is additive: a provider
// MAY report where a statement came from (so a structured list is not misread as prose); an
// absent origin must keep validating — the application coerces it to 'prose-fallback', the
// weakest reading. Test-only import of domain is allowed (see domain-alignment.test.ts).
import { REQUIREMENT_ORIGINS } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { extractionResponseSchema } from '../index.js';

const baseRequirement = {
  statement: 'The export includes headers.',
  type: 'functional',
  concepts: ['export'],
  actors: [],
};

const response = (requirement: Record<string, unknown>): Record<string, unknown> => ({
  requirements: [requirement],
  actors: [],
  constraints: [],
  openQuestions: [],
});

describe('extractionResponseSchema — requirement origin', () => {
  it('validates a requirement without an origin (backward compatible)', () => {
    const parsed = extractionResponseSchema.safeParse(response(baseRequirement));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requirements[0]?.origin).toBeUndefined();
    }
  });

  it.each([...REQUIREMENT_ORIGINS])("round-trips origin '%s'", (origin) => {
    const parsed = extractionResponseSchema.safeParse(response({ ...baseRequirement, origin }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requirements[0]?.origin).toBe(origin);
    }
  });

  it('accepts exactly the domain REQUIREMENT_ORIGINS vocabulary, nothing else', () => {
    const rejected = extractionResponseSchema.safeParse(
      response({ ...baseRequirement, origin: 'model-invented' }),
    );
    expect(rejected.success).toBe(false);
  });

  it('accepts an extraction confidence within [0, 1] and rejects one outside it', () => {
    const accepted = extractionResponseSchema.safeParse(
      response({ ...baseRequirement, origin: 'prose-modal', extractionConfidence: 0.8 }),
    );
    expect(accepted.success).toBe(true);
    const rejected = extractionResponseSchema.safeParse(
      response({ ...baseRequirement, origin: 'prose-modal', extractionConfidence: 1.5 }),
    );
    expect(rejected.success).toBe(false);
  });

  it('stays strict: unknown requirement keys are rejected', () => {
    const rejected = extractionResponseSchema.safeParse(
      response({ ...baseRequirement, provenance: 'human-confirmed' }),
    );
    expect(rejected.success).toBe(false);
  });
});
