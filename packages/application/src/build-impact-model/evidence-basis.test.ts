import { capLikelihood, createGraphNode, primaryEvidenceType } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { classifyCandidate } from './classification.js';
import { basisFor } from './evidence-basis.js';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { MatchMechanism } from './concept-matching.js';
import type { GraphNode } from '@impactgraph/domain';

// Item 3: structural evidence and lexical matches are different kinds of finding, and the tier a
// finding may claim is bounded by its kind. A keyword match must never read as `required`.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-04T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
} as const;

const node = (id: string, type: string, category = 'application'): GraphNode => {
  const created = createGraphNode({ id, type, name: id, category, knowledge });
  if (!created.ok) {
    throw new Error(`node ${id}: ${created.error.issues[0]?.message ?? ''}`);
  }
  return created.value;
};

const candidate = (
  overrides: Partial<ImpactCandidate> & { mechanism?: MatchMechanism } = {},
): ImpactCandidate => {
  const { mechanism = 'exact', ...rest } = overrides;
  return {
    nodeId: 'n1',
    distance: 0,
    dependencyPath: ['n1'],
    edgeTypes: [],
    corroboratingEdgeTypes: [],
    admissible: true,
    weakLinkOnly: false,
    edgeEvidenceIds: [],
    structuralDepth: 0,
    chainHops: 0,
    match: {
      concept: 'DealService',
      nodeId: 'n1',
      mechanism,
      evidenceIds: ['ev-1'],
      ambiguous: false,
      testOnly: false,
    },
    ...rest,
  };
};

describe('basisFor — anchors', () => {
  it('files an identifier match as direct structural evidence', () => {
    expect(basisFor(candidate(), node('n1', 'class')).primary).toBe('direct-structural');
  });

  it('files a semantic match as semantic evidence, not structural', () => {
    expect(basisFor(candidate({ mechanism: 'semantic' }), node('n1', 'class')).primary).toBe(
      'semantic-match',
    );
  });

  it('files a lexical match as lexical-only', () => {
    expect(basisFor(candidate({ mechanism: 'lexical' }), node('n1', 'class')).primary).toBe(
      'lexical-only',
    );
  });

  it('recognizes an async node type on the anchor itself', () => {
    const basis = basisFor(candidate(), node('n1', 'pubsub-topic', 'infrastructure'));
    expect(basis.evidenceTypes).toContain('async-event');
  });

  it('files a fuzzy name match as name-similarity, never as direct structural', () => {
    expect(basisFor(candidate({ mechanism: 'name-similarity' }), node('n1', 'class')).primary).toBe(
      'name-similarity',
    );
  });

  it('does not let a node-type basis out-rank a fuzzy anchor', () => {
    // A fuzzy match on a topic node is still a guess about WHICH topic was meant — the node being
    // async does not upgrade the claim to a required-capable basis.
    const basis = basisFor(
      candidate({ mechanism: 'name-similarity' }),
      node('n1', 'pubsub-topic', 'infrastructure'),
    );
    expect(basis.evidenceTypes).toEqual(['name-similarity']);
  });

  it('does not let a node-type basis out-rank a lexical anchor either', () => {
    const basis = basisFor(
      candidate({ mechanism: 'lexical' }),
      node('n1', 'pubsub-topic', 'infrastructure'),
    );
    expect(basis.evidenceTypes).toEqual(['lexical-only']);
  });
});

describe('basisFor — routes', () => {
  const twoHop = (edgeTypes: readonly string[]): ImpactCandidate =>
    candidate({
      nodeId: 'n2',
      distance: edgeTypes.length,
      dependencyPath: ['n1', 'n2'],
      edgeTypes,
      corroboratingEdgeTypes: [...edgeTypes],
    });

  it('files a single propagating hop as direct structural', () => {
    expect(basisFor(twoHop(['CALLS']), node('n2', 'function')).primary).toBe('direct-structural');
  });

  it('files a two-hop propagating route as transitive structural', () => {
    expect(basisFor(twoHop(['CALLS', 'IMPORTS']), node('n2', 'function')).primary).toBe(
      'transitive-structural',
    );
  });

  it('files a publish/subscribe route as async', () => {
    expect(basisFor(twoHop(['PUBLISHES']), node('n2', 'topic', 'integration')).primary).toBe(
      'async-event',
    );
  });

  it('files a route across an endpoint as an external contract', () => {
    expect(basisFor(twoHop(['CALLS_ENDPOINT']), node('n2', 'api-endpoint')).primary).toBe(
      'external-contract',
    );
  });

  it('files a configuration target as a configuration/asset relationship', () => {
    const basis = basisFor(twoHop(['CONTAINS', 'IMPORTS']), node('n2', 'translation-key', 'asset'));
    expect(basis.evidenceTypes).toContain('configuration-asset');
  });

  it('keeps a route anchored on a lexical match lexical, however long', () => {
    const lexicalRoute = candidate({
      mechanism: 'lexical',
      nodeId: 'n3',
      distance: 2,
      dependencyPath: ['n1', 'n2', 'n3'],
      edgeTypes: ['CALLS', 'IMPORTS'],
      corroboratingEdgeTypes: ['CALLS', 'IMPORTS'],
    });
    expect(basisFor(lexicalRoute, node('n3', 'function')).primary).toBe('lexical-only');
  });

  it('keeps a route anchored on a fuzzy name match at name-similarity, whatever it crosses', () => {
    // The chain is only as strong as the link that attached it to the specification: a route from
    // a guessed anchor across an async boundary must not claim the required-capable async basis.
    const fuzzyRoute = candidate({
      mechanism: 'name-similarity',
      nodeId: 'n3',
      distance: 2,
      dependencyPath: ['n1', 'n2', 'n3'],
      edgeTypes: ['PUBLISHES', 'SUBSCRIBES_TO'],
      corroboratingEdgeTypes: ['PUBLISHES', 'SUBSCRIBES_TO'],
    });
    expect(basisFor(fuzzyRoute, node('n3', 'consumer', 'integration')).evidenceTypes).toEqual([
      'name-similarity',
    ]);
  });
});

describe('capLikelihood', () => {
  it('never lets a lexical basis reach required or likely', () => {
    expect(capLikelihood('required', ['lexical-only'])).toBe('lexical-only');
    expect(capLikelihood('likely', ['lexical-only'])).toBe('lexical-only');
  });

  it('holds a semantic-only match at likely', () => {
    expect(capLikelihood('required', ['semantic-match'])).toBe('likely');
  });

  it('leaves structural evidence untouched', () => {
    expect(capLikelihood('required', ['direct-structural'])).toBe('required');
  });

  it('caps by the STRONGEST basis present, not the weakest', () => {
    expect(capLikelihood('required', ['lexical-only', 'direct-structural'])).toBe('required');
    expect(primaryEvidenceType(['lexical-only', 'direct-structural'])).toBe('direct-structural');
  });

  it('never raises a tier', () => {
    expect(capLikelihood('possible', ['direct-structural'])).toBe('possible');
  });
});

describe('classifyCandidate — tiers follow the basis', () => {
  it('labels an exact anchor required and records the basis', () => {
    const classified = classifyCandidate(candidate(), node('n1', 'class'), 'req-1');
    expect(classified.ok).toBe(true);
    if (!classified.ok) {
      return;
    }
    expect(classified.value.likelihood).toBe('required');
    expect(classified.value.evidenceTypes).toEqual(['direct-structural']);
    expect(classified.value.tierCappedBy).toBeUndefined();
    expect(classified.value.explanation).toContain('Basis: direct-structural');
  });

  it('labels a lexical anchor lexical-only and says the tier was capped', () => {
    const classified = classifyCandidate(
      candidate({ mechanism: 'lexical' }),
      node('n1', 'class'),
      'req-1',
    );
    expect(classified.ok).toBe(true);
    if (!classified.ok) {
      return;
    }
    expect(classified.value.likelihood).toBe('lexical-only');
    expect(classified.value.tierCappedBy).toBe('lexical-only');
  });

  it('labels a semantic anchor possible rather than required', () => {
    const classified = classifyCandidate(
      candidate({ mechanism: 'semantic' }),
      node('n1', 'class'),
      'req-1',
    );
    expect(classified.ok).toBe(true);
    if (!classified.ok) {
      return;
    }
    expect(classified.value.likelihood).toBe('possible');
  });

  it('caps a fuzzy-matched anchor at likely and records why (never rejected)', () => {
    const classified = classifyCandidate(
      candidate({ mechanism: 'name-similarity' }),
      node('n1', 'class'),
      'req-1',
    );
    expect(classified.ok).toBe(true);
    if (!classified.ok) {
      return;
    }
    expect(classified.value.likelihood).toBe('likely');
    expect(classified.value.evidenceTypes).toEqual(['name-similarity']);
    expect(classified.value.tierCappedBy).toBe('name-similarity');
  });

  it('keeps exact and alias anchors at required with a direct structural basis', () => {
    for (const mechanism of ['exact', 'alias'] as const) {
      const classified = classifyCandidate(candidate({ mechanism }), node('n1', 'class'), 'req-1');
      expect(classified.ok).toBe(true);
      if (!classified.ok) {
        continue;
      }
      expect(classified.value.likelihood).toBe('required');
      expect(classified.value.evidenceTypes).toEqual(['direct-structural']);
      expect(classified.value.tierCappedBy).toBeUndefined();
    }
  });
});
