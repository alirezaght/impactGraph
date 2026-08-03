import { createFakeModelProvider } from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { createImpactClassifier, createNullProvider } from './index.js';

import type { ClassificationRequest } from '@impactgraph/application';

const request: ClassificationRequest = {
  requirementId: 'req-1',
  requirementStatement: 'DealVisibilityPolicy must hide expired deals.',
  candidates: [
    {
      nodeId: 'sym:policy',
      name: 'DealVisibilityPolicy',
      nodeType: 'policy',
      category: 'domain',
      distance: 0,
      path: 'DealVisibilityPolicy',
    },
    {
      nodeId: 'table:deals',
      name: 'deals',
      nodeType: 'table',
      category: 'data',
      distance: 1,
      path: 'DealVisibilityPolicy → deals',
    },
  ],
};

const validOutput = {
  classifications: [
    {
      nodeId: 'table:deals',
      likelihood: 'required',
      impactType: 'migration',
      explanation: 'Existing rows must be updated.',
      expectedChanges: ['Add migration'],
    },
  ],
};

describe('impact classifier over ModelProviderPort (Story 6.3)', () => {
  it('returns schema-validated classifications; prompt is bounded and injection-defended', async () => {
    const provider = createFakeModelProvider([validOutput]);
    const result = await createImpactClassifier(provider).classify(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.impactType).toBe('migration');
    }
    expect(provider.requests[0]?.systemPrompt).toContain('ONLY reference the listed node ids');
    expect(provider.requests[0]?.systemPrompt).toContain('UNTRUSTED DATA');
    expect(provider.requests[0]?.prompt).toContain('nodeId: table:deals');
    expect(provider.requests[0]?.prompt).toContain('<requirement>');
  });

  it('rejects out-of-taxonomy output at the schema gate — retried once, never used (§47.8)', async () => {
    const invalid = {
      classifications: [
        {
          nodeId: 'table:deals',
          likelihood: 'certain',
          impactType: 'migration',
          explanation: 'x',
          expectedChanges: [],
        },
      ],
    };
    const provider = createFakeModelProvider([invalid, invalid]);
    const result = await createImpactClassifier(provider).classify(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-output');
    }
    expect(provider.requests).toHaveLength(2);
  });

  it('the null provider degrades to deterministic-only (§8)', async () => {
    const result = await createImpactClassifier(createNullProvider()).classify(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-configured');
    }
  });
});
