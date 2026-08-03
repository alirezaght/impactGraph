import { describe, expect, it } from 'vitest';

import { createGraphNode, NODE_TYPES_BY_CATEGORY } from '../index.js';

import type { KnowledgeEnvelopeInput } from '../index.js';

const envelope = (overrides: Partial<KnowledgeEnvelopeInput> = {}): KnowledgeEnvelopeInput => ({
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-4f8a29c',
  analysisRunId: 'run-001',
  ...overrides,
});

const validNode = {
  id: 'node-deal-service',
  category: 'application',
  type: 'service',
  name: 'DealService',
  path: 'src/deals/application/DealService.ts',
  knowledge: envelope(),
};

describe('node vocabulary (PRD §12.1)', () => {
  it('covers all seven categories with the PRD rosters', () => {
    expect(Object.keys(NODE_TYPES_BY_CATEGORY)).toEqual([
      'intent',
      'domain',
      'application',
      'data',
      'integration',
      'infrastructure',
      'repository',
    ]);
    expect(NODE_TYPES_BY_CATEGORY.intent).toHaveLength(7);
    expect(NODE_TYPES_BY_CATEGORY.domain).toHaveLength(10);
    expect(NODE_TYPES_BY_CATEGORY.application).toHaveLength(17);
    expect(NODE_TYPES_BY_CATEGORY.data).toHaveLength(9);
    expect(NODE_TYPES_BY_CATEGORY.integration).toHaveLength(8);
    expect(NODE_TYPES_BY_CATEGORY.infrastructure).toHaveLength(13);
    expect(NODE_TYPES_BY_CATEGORY.repository).toHaveLength(6);
  });

  it('keeps package legal in both application and repository categories', () => {
    expect(NODE_TYPES_BY_CATEGORY.application).toContain('package');
    expect(NODE_TYPES_BY_CATEGORY.repository).toContain('package');
  });
});

describe('createGraphNode (PRD §12, Story 1.1)', () => {
  it('constructs a frozen node for every category/type pair', () => {
    for (const [category, types] of Object.entries(NODE_TYPES_BY_CATEGORY)) {
      for (const type of types) {
        const result = createGraphNode({ ...validNode, category, type });
        expect(result.ok, `${category}/${type}`).toBe(true);
        if (result.ok) {
          expect(Object.isFrozen(result.value)).toBe(true);
          expect(Object.isFrozen(result.value.knowledge)).toBe(true);
        }
      }
    }
  });

  it('rejects a type that does not belong to the declared category', () => {
    const result = createGraphNode({ ...validNode, category: 'data', type: 'service' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'type-category-mismatch')).toBe(true);
    }
  });

  it('rejects unknown categories and unknown types', () => {
    expect(createGraphNode({ ...validNode, category: 'ui' }).ok).toBe(false);
    expect(createGraphNode({ ...validNode, type: 'microservice' }).ok).toBe(false);
  });

  it('rejects construction with unknown provenance', () => {
    const result = createGraphNode({
      ...validNode,
      knowledge: envelope({ provenance: 'guesswork' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'unknown-provenance')).toBe(true);
    }
  });

  it('rejects the reserved runtime-observation provenance in V1', () => {
    const result = createGraphNode({
      ...validNode,
      knowledge: envelope({ provenance: 'runtime-observation' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'reserved-provenance')).toBe(true);
    }
  });

  it('requires evidence for anything not human-confirmed', () => {
    const inferred = createGraphNode({
      ...validNode,
      knowledge: envelope({ provenance: 'llm-inferred', evidenceIds: [] }),
    });
    expect(inferred.ok).toBe(false);
    if (!inferred.ok) {
      expect(inferred.error.issues.some((i) => i.code === 'missing-evidence')).toBe(true);
    }

    const confirmed = createGraphNode({
      ...validNode,
      knowledge: envelope({ provenance: 'human-confirmed', evidenceIds: [] }),
    });
    expect(confirmed.ok).toBe(true);
  });

  it('rejects blank ids, names, and evidence ids', () => {
    expect(createGraphNode({ ...validNode, id: '' }).ok).toBe(false);
    expect(createGraphNode({ ...validNode, name: '  ' }).ok).toBe(false);
    expect(
      createGraphNode({ ...validNode, knowledge: envelope({ evidenceIds: ['ev-1', ' '] }) }).ok,
    ).toBe(false);
  });

  it('carries an optional specification reference when provided', () => {
    const result = createGraphNode({
      ...validNode,
      knowledge: envelope({
        specification: { specificationId: 'spec-1', specificationVersion: 2 },
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.knowledge.specification?.specificationVersion).toBe(2);
    }
  });
});
