import { createGraphNode, createImpactAnalysis, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildRequirementSignals, indexedTypes } from './requirement-signals.js';
import { resolveSuppliedIdentifiers } from './supplied-identifiers.js';

import type { ImpactAnalysis, KnowledgeGraph } from '@impactgraph/domain';

// The INVALID_ASSUMPTION signal must consume the SAME path resolution the analyze summary
// reports: a service-relative path that suffix-resolves against the workspace-relative index is
// a resolved identifier, never evidence that the specification asserts a missing file.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const graphWith = (paths: readonly string[]): KnowledgeGraph => {
  const nodes = paths.map((path) => {
    const node = createGraphNode({
      id: `file:${path}`,
      name: path.split('/').pop() ?? path,
      category: 'repository',
      type: 'file',
      path,
      knowledge,
    });
    if (!node.ok) {
      throw new Error('bad fixture node');
    }
    return node.value;
  });
  const created = createKnowledgeGraph(nodes, []);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const emptyAnalysis = (): ImpactAnalysis => {
  const created = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-17T10:00:00.000Z',
    status: 'draft',
    requirementImpacts: [],
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });
  if (!created.ok) {
    throw new Error('bad fixture analysis');
  }
  return created.value;
};

describe('buildRequirementSignals and supplied identifiers', () => {
  it('does not flag an invalid assumption for a path that suffix-resolves', () => {
    const graph = graphWith(['packages/application/src/build-impact-model/concept-matching.ts']);
    const statement = 'Modify src/build-impact-model/concept-matching.ts to use the resolver.';

    const signals = buildRequirementSignals(statement, 'REQ-1', {
      analysis: emptyAnalysis(),
      missingRepositoryCount: 0,
      indexedNodeTypes: indexedTypes(graph),
      unresolvedSuppliedIdentifiers: resolveSuppliedIdentifiers(statement, graph).unresolved,
    });

    expect(signals.hasInvalidSymbolAssumption).toBe(false);
  });

  it('still flags a stated path that resolves nowhere', () => {
    const graph = graphWith(['packages/application/src/index.ts']);
    const statement = 'Modify services/x.py to relay the events.';

    const signals = buildRequirementSignals(statement, 'REQ-1', {
      analysis: emptyAnalysis(),
      missingRepositoryCount: 0,
      indexedNodeTypes: indexedTypes(graph),
      unresolvedSuppliedIdentifiers: resolveSuppliedIdentifiers(statement, graph).unresolved,
    });

    expect(signals.hasInvalidSymbolAssumption).toBe(true);
  });
});
