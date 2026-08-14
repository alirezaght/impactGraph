import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { traverseCandidates } from './candidate-traversal.js';

import type { ConceptMatch } from './concept-matching.js';
import type { KnowledgeGraph } from '@impactgraph/domain';

const knowledge = {
  provenance: 'configuration',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

// package:store DEPENDS_ON dependency:better-sqlite3; the store also contains a file.
const graph = ((): KnowledgeGraph => {
  const nodes = [
    { id: 'package:store', category: 'repository', type: 'package', name: 'store' },
    {
      id: 'dependency:better-sqlite3',
      category: 'integration',
      type: 'third-party-service',
      name: 'better-sqlite3',
    },
    { id: 'file:store/index.ts', category: 'repository', type: 'file', name: 'index.ts' },
  ].map((spec) => {
    const result = createGraphNode({ ...spec, knowledge });
    if (!result.ok) {
      throw new Error(`node ${spec.id}`);
    }
    return result.value;
  });
  const edges = [
    {
      id: 'depends-on:package:store->dependency:better-sqlite3',
      type: 'DEPENDS_ON',
      sourceId: 'package:store',
      targetId: 'dependency:better-sqlite3',
    },
    {
      id: 'contains:file:store/index.ts',
      type: 'CONTAINS',
      sourceId: 'package:store',
      targetId: 'file:store/index.ts',
    },
  ].map((spec) => {
    const result = createGraphEdge({ ...spec, knowledge });
    if (!result.ok) {
      throw new Error(`edge ${spec.id}`);
    }
    return result.value;
  });
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
})();

const match = (nodeId: string, concept = 'c'): ConceptMatch => ({
  concept,
  nodeId,
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
});

const smallGraph = (
  edgeSpecs: readonly { type: string; sourceId: string; targetId: string }[],
): KnowledgeGraph => {
  const ids = [...new Set(edgeSpecs.flatMap((spec) => [spec.sourceId, spec.targetId]))];
  const nodes = ids.map((id) => {
    const result = createGraphNode({
      id,
      category: 'repository',
      type: 'symbol',
      name: id,
      knowledge,
    });
    if (!result.ok) {
      throw new Error(`node ${id}`);
    }
    return result.value;
  });
  const edges = edgeSpecs.map((spec, index) => {
    const result = createGraphEdge({ ...spec, id: `edge-${String(index)}`, knowledge });
    if (!result.ok) {
      throw new Error(`edge ${String(index)}`);
    }
    return result.value;
  });
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

// The collision guard (concept-matching) asks whether anything ELSE ties a node to the
// requirement. Route dominance is untouched — a longer route still never replaces or rescores the
// kept one — but its arrival is recorded as corroboration metadata.
describe('traverseCandidates corroboration metadata', () => {
  it('records every concept whose routes reached a node, even over a longer route', () => {
    // symbol:service imports symbol:auth; each is anchored by its own concept.
    const graph = smallGraph([
      { type: 'IMPORTS', sourceId: 'symbol:service', targetId: 'symbol:auth' },
    ]);

    const result = traverseCandidates(graph, [
      match('symbol:auth', 'require_internal_auth'),
      match('symbol:service', 'AuthService'),
    ]);
    const auth = result.candidates.find((candidate) => candidate.nodeId === 'symbol:auth');

    expect(auth?.distance).toBe(0);
    expect(auth?.anchorConcepts).toEqual(['AuthService', 'require_internal_auth']);
    expect(auth?.propagationCorroborated).toBe(true);
  });

  it('never lets a walk out of a node and back corroborate the node itself', () => {
    const graph = smallGraph([{ type: 'IMPORTS', sourceId: 'symbol:x', targetId: 'symbol:y' }]);

    const result = traverseCandidates(graph, [match('symbol:x')]);
    const anchor = result.candidates.find((candidate) => candidate.nodeId === 'symbol:x');

    expect(anchor?.anchorConcepts).toEqual(['c']);
    expect(anchor?.propagationCorroborated).toBe(false);
  });

  it('counts a supporting route as another concept but not as propagation', () => {
    const graph = smallGraph([{ type: 'USES', sourceId: 'symbol:z', targetId: 'symbol:x' }]);

    const result = traverseCandidates(graph, [match('symbol:x', 'c1'), match('symbol:z', 'c2')]);
    const anchor = result.candidates.find((candidate) => candidate.nodeId === 'symbol:x');

    expect(anchor?.anchorConcepts).toEqual(['c1', 'c2']);
    expect(anchor?.propagationCorroborated).toBe(false);
  });
});

describe('traverseCandidates and external dependencies', () => {
  it('reaches the packages that declare a dependency when the dependency is named', () => {
    const result = traverseCandidates(graph, [match('dependency:better-sqlite3')]);

    expect(result.candidates.map((candidate) => candidate.nodeId)).toContain('package:store');
  });

  // A library is not a component this repository changes, so naming a package must not turn
  // every library it declares into an impact — the fan-out the DEPENDS_ON edges would otherwise
  // produce is the same blast radius that loose concept matching used to cause.
  it('does not turn a package into impacts on every library it declares', () => {
    const result = traverseCandidates(graph, [match('package:store')]);

    expect(result.candidates.map((candidate) => candidate.nodeId)).not.toContain(
      'dependency:better-sqlite3',
    );
  });
});
