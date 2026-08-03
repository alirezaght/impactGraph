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

const match = (nodeId: string): ConceptMatch => ({
  concept: 'c',
  nodeId,
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
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
