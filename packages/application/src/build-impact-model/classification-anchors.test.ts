import { createGraphNode } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { classifyCandidate } from './classification.js';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { ConceptMatch } from './concept-matching.js';
import type { GraphNode, RequirementImpact } from '@impactgraph/domain';

// "Required must mean strong" (field evaluation: a design doc produced 505 impacts because the
// product name matched `package:impactgraph` at required/0.9 and a bare `specification.ts`
// matched the wrong file at required/0.9). Split from classification.test.ts for the
// effective-LOC policy; the helpers are deliberately identical.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

interface NodeSpec {
  readonly id: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
}

const node = (spec: NodeSpec): GraphNode => {
  const result = createGraphNode({ ...spec, knowledge });
  if (!result.ok) {
    throw new Error(`node ${spec.id}`);
  }
  return result.value;
};

const matchOf = (over: Partial<ConceptMatch>): ConceptMatch => ({
  concept: 'ImpactGraph',
  nodeId: 'package:impactgraph',
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
  ...over,
});

const candidateOf = (match: ConceptMatch): ImpactCandidate => ({
  nodeId: match.nodeId,
  distance: 0,
  dependencyPath: [match.nodeId],
  edgeTypes: [],
  corroboratingEdgeTypes: [],
  admissible: true,
  weakLinkOnly: false,
  edgeEvidenceIds: [],
  structuralDepth: 0,
  chainHops: 0,
  anchorConcepts: [match.concept],
  propagationCorroborated: false,
  match,
});

const classify = (match: ConceptMatch, target: GraphNode): RequirementImpact => {
  const result = classifyCandidate(candidateOf(match), target, 'REQ-1');
  if (!result.ok) {
    throw new Error('classification failed');
  }
  return result.value;
};

describe('container-name anchors', () => {
  const packageNode = node({
    id: 'package:impactgraph',
    category: 'repository',
    type: 'package',
    name: 'impactgraph',
    path: 'package.json',
  });

  it('caps a product-name match to a package node at possible with weak confidence', () => {
    const impact = classify(matchOf({}), packageNode);

    expect(impact.likelihood).toBe('possible');
    expect(impact.confidence).toBeLessThan(0.6);
    expect(impact.explanation).toContain('container');
    expect(impact.confidenceSignals.map((signal) => signal.type)).toContain('container-name-match');
    expect(impact.confidenceSignals.map((signal) => signal.type)).not.toContain(
      'exact-concept-to-symbol-match',
    );
  });

  it('caps an alias match to a container the same way', () => {
    const impact = classify(matchOf({ mechanism: 'alias' }), packageNode);

    expect(impact.likelihood).toBe('possible');
    expect(impact.confidence).toBeLessThan(0.6);
  });

  it('caps a directory-kind node reached by name', () => {
    const directory = node({
      id: 'dir:billing',
      category: 'repository',
      type: 'directory',
      name: 'billing',
      path: 'services/billing',
    });
    const impact = classify(matchOf({ concept: 'billing', nodeId: 'dir:billing' }), directory);

    expect(impact.likelihood).toBe('possible');
  });

  it('keeps a path-shaped concept resolving to the container manifest at required', () => {
    const impact = classify(matchOf({ concept: 'apps/impactgraph/package.json' }), packageNode);

    expect(impact.likelihood).toBe('required');
    expect(impact.confidenceSignals.map((signal) => signal.type)).toContain(
      'exact-concept-to-symbol-match',
    );
  });

  it('leaves an exact name match to a non-container node at required', () => {
    const service = node({
      id: 'symbol:policy',
      category: 'application',
      type: 'class',
      name: 'DealVisibilityPolicy',
    });
    const impact = classify(
      matchOf({ concept: 'DealVisibilityPolicy', nodeId: 'symbol:policy' }),
      service,
    );

    expect(impact.likelihood).toBe('required');
    expect(impact.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('basename and path-suffix anchors', () => {
  it('caps a unique basename match at likely with the tier cap recorded', () => {
    const file = node({
      id: 'file:spec',
      category: 'repository',
      type: 'file',
      name: 'specification.ts',
      path: 'packages/domain/src/specification.ts',
    });
    const impact = classify(
      matchOf({ concept: 'specification.ts', nodeId: 'file:spec', mechanism: 'basename' }),
      file,
    );

    expect(impact.likelihood).toBe('likely');
    expect(impact.tierCappedBy).toBe('name-similarity');
    expect(impact.confidence).toBeLessThan(0.6);
    expect(impact.confidenceSignals.map((signal) => signal.type)).toContain('basename-file-match');
  });

  it('treats a unique path-suffix resolution as identifier-grade', () => {
    const file = node({
      id: 'file:cm',
      category: 'repository',
      type: 'file',
      name: 'concept-matching.ts',
      path: 'packages/application/src/build-impact-model/concept-matching.ts',
    });
    const impact = classify(
      matchOf({
        concept: 'src/build-impact-model/concept-matching.ts',
        nodeId: 'file:cm',
        mechanism: 'path-suffix',
      }),
      file,
    );

    expect(impact.likelihood).toBe('required');
    expect(impact.evidenceTypes).toContain('direct-structural');
    expect(impact.confidenceSignals.map((signal) => signal.type)).toContain(
      'exact-concept-to-symbol-match',
    );
  });
});
