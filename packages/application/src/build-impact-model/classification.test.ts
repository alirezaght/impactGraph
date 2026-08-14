import { createGraphNode, likelihoodRank, PREDICTIVE_LIKELIHOODS } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { classifyCandidate } from './classification.js';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { ConceptMatch } from './concept-matching.js';
import type { GraphNode, RequirementImpact } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, category: string, type: string, name: string): GraphNode => {
  const result = createGraphNode({ id, category, type, name, knowledge });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const matchOf = (over: Partial<ConceptMatch>): ConceptMatch => ({
  concept: 'require_internal_auth',
  nodeId: 'symbol:auth',
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
  ...over,
});

const candidateOf = (match: ConceptMatch, over: Partial<ImpactCandidate>): ImpactCandidate => ({
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
  ...over,
});

const classify = (candidate: ImpactCandidate, target: GraphNode): RequirementImpact => {
  const result = classifyCandidate(candidate, target, 'REQ-1');
  if (!result.ok) {
    throw new Error('classification failed');
  }
  return result.value;
};

// Field report: `require_internal_auth` existed in several unrelated services, and every copy
// arrived `required` because each exact match landed at distance 0. A name existing in N places is
// N coincidences until something structural ties one of them to the requirement.
describe('classifyCandidate and exact-name collisions', () => {
  const collision = {
    count: 3,
    containers: ['auth-service', 'billing-service', 'notification-service'],
  } as const;
  const collided = matchOf({ ambiguous: true, collision });
  const authNode = node('symbol:auth', 'repository', 'symbol', 'require_internal_auth');

  it('caps an uncorroborated collision match at possible and states the collision', () => {
    const impact = classify(candidateOf(collided, {}), authNode);

    expect(impact.likelihood).toBe('possible');
    expect(impact.explanation).toContain(
      "name 'require_internal_auth' exists in 3 places (auth-service, billing-service, " +
        'notification-service); nothing structural ties this one to the requirement',
    );
  });

  it('keeps the tier when a second concept of the requirement reached the same node', () => {
    const impact = classify(
      candidateOf(collided, { anchorConcepts: ['AuthService', 'require_internal_auth'] }),
      authNode,
    );

    expect(impact.likelihood).toBe('required');
    expect(impact.explanation).not.toContain('nothing structural ties');
  });

  it('keeps the tier when a propagating route from another anchor reached the node', () => {
    const impact = classify(candidateOf(collided, { propagationCorroborated: true }), authNode);

    expect(impact.likelihood).toBe('required');
  });

  it('leaves a collision-free exact anchor at required', () => {
    const impact = classify(candidateOf(matchOf({}), {}), authNode);

    expect(impact.likelihood).toBe('required');
  });
});

// Live run on this repo: a fuzzy anchor walked CONTAINS up to its package, then DEPENDS_ON up to
// every dependent package — 9 of the 12 shown impacts were package.json files at 'possible'.
describe('classifyCandidate and container fan-out', () => {
  const fuzzy = matchOf({ concept: 'deals', nodeId: 'symbol:ctrl', mechanism: 'name-similarity' });
  const packageNode = node('package:web', 'repository', 'package', 'web');
  const fanOutRoute = {
    nodeId: 'package:web',
    distance: 2,
    dependencyPath: ['symbol:ctrl', 'package:core', 'package:web'],
    edgeTypes: ['CONTAINS', 'DEPENDS_ON'],
    corroboratingEdgeTypes: ['CONTAINS', 'DEPENDS_ON'],
  };

  it('classifies a container reached only via ownership edges from a fuzzy anchor as unlikely', () => {
    const impact = classify(candidateOf(fuzzy, fanOutRoute), packageNode);

    expect(impact.likelihood).toBe('unlikely');
    expect(impact.explanation).toContain(
      'reached only through ownership edges from a fuzzy name match',
    );
  });

  it('unlikely ranks below possible and is excluded from the default view', () => {
    expect(likelihoodRank('unlikely')).toBeGreaterThan(likelihoodRank('possible'));
    expect(PREDICTIVE_LIKELIHOODS).not.toContain('unlikely');
  });

  it('keeps the current tier for the same route from an exact anchor', () => {
    const exact = matchOf({ concept: 'ctrl', nodeId: 'symbol:ctrl' });
    const impact = classify(candidateOf(exact, fanOutRoute), packageNode);

    expect(impact.likelihood).toBe('possible');
  });

  it('keeps the current tier when a propagating edge also reached the container', () => {
    const impact = classify(
      candidateOf(fuzzy, {
        ...fanOutRoute,
        corroboratingEdgeTypes: ['CONTAINS', 'DEPENDS_ON', 'IMPORTS'],
      }),
      packageNode,
    );

    expect(impact.likelihood).toBe('possible');
  });

  it('leaves a source file reached via IMPORTS from a fuzzy anchor unaffected', () => {
    const fileNode = node('file:svc', 'repository', 'file', 'deals.service.ts');
    const impact = classify(
      candidateOf(fuzzy, {
        nodeId: 'file:svc',
        distance: 1,
        dependencyPath: ['symbol:ctrl', 'file:svc'],
        edgeTypes: ['IMPORTS'],
        corroboratingEdgeTypes: ['IMPORTS'],
      }),
      fileNode,
    );

    expect(impact.likelihood).toBe('likely');
  });
});
