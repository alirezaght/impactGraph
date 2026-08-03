import { describe, expect, it } from 'vitest';

import { createGraphEdge, EDGE_TYPES } from '../index.js';

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

const validEdge = {
  id: 'edge-dealservice-imports-dealrepo',
  type: 'IMPORTS',
  sourceId: 'node-deal-service',
  targetId: 'node-deal-repository',
  knowledge: envelope(),
};

describe('edge vocabulary (PRD §12.2)', () => {
  it('models the full PRD edge-type roster', () => {
    expect([...EDGE_TYPES]).toEqual([
      'CONTAINS',
      'IMPORTS',
      'CALLS',
      'IMPLEMENTS',
      'EXTENDS',
      'READS_FROM',
      'WRITES_TO',
      'PUBLISHES',
      'SUBSCRIBES_TO',
      'TRIGGERS',
      'DEPLOYED_AS',
      'CONFIGURES',
      'OWNS',
      'BELONGS_TO_CONTEXT',
      'VALIDATES',
      'ENFORCES',
      'TESTS',
      'MIGRATES',
      'EXPOSES',
      'USES',
      // §12.2.1 relationship split — USES carried seven unrelated facts and doubled as the
      // adapter fallback for unclassifiable bindings.
      'INJECTS',
      'NAVIGATES_TO',
      'SUBMITS_TO',
      'CALLS_ENDPOINT',
      'USES_MIDDLEWARE',
      'REFERENCES_RESOURCE',
      'BINDS',
      'USES_UNKNOWN',
      'DEPENDS_ON',
      'AFFECTS',
      'MAY_AFFECT',
      'CONTRADICTS',
      'SATISFIES',
      'REQUIRES',
      'DOCUMENTS',
      'GENERATED_FROM',
    ]);
  });
});

describe('createGraphEdge (PRD §12, Story 1.1)', () => {
  it('constructs a frozen edge for every edge type', () => {
    for (const type of EDGE_TYPES) {
      const result = createGraphEdge({ ...validEdge, type });
      expect(result.ok, type).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    }
  });

  it('rejects unknown edge types', () => {
    const result = createGraphEdge({ ...validEdge, type: 'LINKS_TO' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.code === 'unknown-edge-type')).toBe(true);
    }
  });

  it('rejects blank source/target/edge ids', () => {
    expect(createGraphEdge({ ...validEdge, id: ' ' }).ok).toBe(false);
    expect(createGraphEdge({ ...validEdge, sourceId: '' }).ok).toBe(false);
    expect(createGraphEdge({ ...validEdge, targetId: '' }).ok).toBe(false);
  });

  it('applies the same provenance envelope rules as nodes', () => {
    const reserved = createGraphEdge({
      ...validEdge,
      knowledge: envelope({ provenance: 'runtime-observation' }),
    });
    expect(reserved.ok).toBe(false);

    const noEvidence = createGraphEdge({
      ...validEdge,
      knowledge: envelope({ provenance: 'llm-inferred', evidenceIds: [] }),
    });
    expect(noEvidence.ok).toBe(false);

    const humanConfirmed = createGraphEdge({
      ...validEdge,
      knowledge: envelope({ provenance: 'human-confirmed', evidenceIds: [] }),
    });
    expect(humanConfirmed.ok).toBe(true);
  });

  it('collects multiple issues in one typed error', () => {
    const result = createGraphEdge({
      ...validEdge,
      id: '',
      type: 'LINKS_TO',
      knowledge: envelope({ provenance: 'guesswork' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('ValidationError');
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});
