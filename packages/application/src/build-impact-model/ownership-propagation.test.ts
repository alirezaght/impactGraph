import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { traverseCandidates } from './candidate-traversal.js';

import type { ConceptMatch } from './concept-matching.js';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Path-shape rules for ownership edges. The negative shape is
//   exact anchor —CONTAINS→ its file —any relationship→ anything
// which changes the subject from "affected by this symbol" to "connected to its file". The positive
// shape is the same first hop plus a separate route that ties the candidate to the anchor itself.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, type: string, name: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: type === 'test' ? 'application' : 'repository',
    type,
    name,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, type: string, sourceId: string, targetId: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId, targetId, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const graphOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const anchorMatch: ConceptMatch = {
  concept: 'Anchor',
  nodeId: 'symbol:anchor',
  mechanism: 'exact',
  evidenceIds: ['ev-1'],
  ambiguous: false,
  testOnly: false,
};

const reachedFrom = (graph: KnowledgeGraph): Set<string> =>
  new Set(traverseCandidates(graph, [anchorMatch]).candidates.map((c) => c.nodeId));

/**
 * symbol:anchor lives in file:host. The host file also declares an unrelated sibling, re-exports
 * through a barrel, and imports a contract the anchor never touches.
 */
const coLocationGraph = graphOf(
  [
    node('symbol:anchor', 'symbol', 'Anchor'),
    node('file:host', 'file', 'host.ts'),
    node('symbol:sibling', 'symbol', 'Sibling'),
    node('file:barrel', 'file', 'index.ts'),
    node('file:contract', 'file', 'contract.ts'),
  ],
  [
    edge('e-contains-anchor', 'CONTAINS', 'file:host', 'symbol:anchor'),
    edge('e-contains-sibling', 'CONTAINS', 'file:host', 'symbol:sibling'),
    edge('e-barrel', 'IMPORTS', 'file:barrel', 'file:host'),
    edge('e-contract', 'IMPORTS', 'file:host', 'file:contract'),
  ],
);

describe('ownership edges do not propagate past the container', () => {
  it('admits the file that declares the anchored symbol', () => {
    expect(reachedFrom(coLocationGraph)).toContain('file:host');
  });

  it('does not admit a contract the containing file imports but the anchor never touches', () => {
    // The direction is what condemns this one: the host file depends on the contract, so change
    // flows the other way. Nothing about the anchor implies the contract moves.
    expect(reachedFrom(coLocationGraph)).not.toContain('file:contract');
  });

  it('does not admit a sibling declared beside the anchor in the same file', () => {
    expect(reachedFrom(coLocationGraph)).not.toContain('symbol:sibling');
  });

  it('still admits something that imports the containing file (§46 dependents)', () => {
    // A KNOWN residue. `export *` barrels are indistinguishable here from a genuine consumer:
    // both simply import the file declaring the anchor, and the graph records no symbol-level use
    // to separate them. Surfacing dependents the specification never named is a §46 promise, so
    // the ambiguity is resolved in favour of recall until symbol-level usage can decide it.
    expect(reachedFrom(coLocationGraph)).toContain('file:barrel');
  });

  it('reports what it refused rather than dropping it silently', () => {
    const result = traverseCandidates(coLocationGraph, [anchorMatch]);

    expect(result.ownershipOnly).toContain('file:contract');
  });
});

describe('a second route past the container restores admission', () => {
  it('admits a component the anchor itself calls, even though ownership also reaches it', () => {
    const graph = graphOf(
      [
        node('symbol:anchor', 'symbol', 'Anchor'),
        node('file:host', 'file', 'host.ts'),
        node('file:used', 'file', 'used.ts'),
        node('symbol:used', 'symbol', 'Used'),
      ],
      [
        edge('e-contains', 'CONTAINS', 'file:host', 'symbol:anchor'),
        edge('e-host-imports', 'IMPORTS', 'file:host', 'file:used'),
        edge('e-contains-used', 'CONTAINS', 'file:used', 'symbol:used'),
        // The anchor calls the symbol directly: a route that never passes through file:host.
        edge('e-anchor-calls', 'CALLS', 'symbol:anchor', 'symbol:used'),
      ],
    );
    const reached = reachedFrom(graph);

    expect(reached).toContain('symbol:used');
    // file:used is admitted too, and should be: it is reached as
    // anchor —CALLS→ symbol:used —CONTAINS↑→ file:used, which is rolling a real symbol impact up to
    // the file that declares it. Ownership as the LAST hop is the legitimate use; the rule only
    // refuses it as the FIRST hop, where it would carry the walk out of the anchor's own container.
    expect(reached).toContain('file:used');
  });

  it('keeps a test associated with the anchor, whose route does not start through ownership', () => {
    const graph = graphOf(
      [
        node('symbol:anchor', 'symbol', 'Anchor'),
        node('file:host', 'file', 'host.ts'),
        node('symbol:spec', 'test', 'anchorSpec'),
        node('file:spec', 'file', 'anchor.test.ts'),
      ],
      [
        edge('e-contains', 'CONTAINS', 'file:host', 'symbol:anchor'),
        // TESTS is a supporting relationship, not ownership: it ties the test to the anchor.
        edge('e-tests', 'TESTS', 'symbol:spec', 'symbol:anchor'),
        edge('e-contains-spec', 'CONTAINS', 'file:spec', 'symbol:spec'),
      ],
    );
    const reached = reachedFrom(graph);

    expect(reached).toContain('symbol:spec');
    expect(reached).toContain('file:spec');
  });

  it('does not treat the two edges of one chain as independent support', () => {
    // anchor —CONTAINS→ host —IMPORTS→ far. The chain contains an import, but no route to `far`
    // begins anywhere other than the anchor's own file, so the import is not independent evidence.
    const graph = graphOf(
      [
        node('symbol:anchor', 'symbol', 'Anchor'),
        node('file:host', 'file', 'host.ts'),
        node('file:far', 'file', 'far.ts'),
      ],
      [
        edge('e-contains', 'CONTAINS', 'file:host', 'symbol:anchor'),
        edge('e-imports', 'IMPORTS', 'file:host', 'file:far'),
      ],
    );

    expect(reachedFrom(graph)).not.toContain('file:far');
  });
});

// §12.2.1 direction invariants. An INJECTS edge must mean the same thing whatever produced it, or a
// propagation rule attached to it cannot stay local. Source is the consumer receiving the
// dependency; target is the thing supplied. One case per producer of the type.
describe('INJECTS points from consumer to injected dependency', () => {
  const injectionGraph = (edgeId: string): KnowledgeGraph =>
    graphOf(
      [node('symbol:consumer', 'symbol', 'Worker'), node('symbol:dependency', 'symbol', 'Helper')],
      [edge(edgeId, 'INJECTS', 'symbol:consumer', 'symbol:dependency')],
    );

  for (const [producer, edgeId] of [
    ['constructor injection (assembly)', 'injects:symbol:consumer->symbol:dependency'],
    ['Spring @Autowired', 'spring:autowired:symbol:consumer->symbol:dependency'],
  ] as const) {
    it(`reaches the consumer when the dependency is anchored — ${producer}`, () => {
      const anchored: ConceptMatch = { ...anchorMatch, nodeId: 'symbol:dependency' };
      const reached = traverseCandidates(injectionGraph(edgeId), [anchored]).candidates;

      // Impact flows to the dependent: changing Helper reaches Worker, which injects it.
      expect(reached.map((c) => c.nodeId)).toContain('symbol:consumer');
    });
  }

  it('treats a reverse injection as weak, never as likely on its own', () => {
    const anchored: ConceptMatch = { ...anchorMatch, nodeId: 'symbol:dependency' };
    const consumer = traverseCandidates(injectionGraph('injects:a->b'), [anchored]).candidates.find(
      (candidate) => candidate.nodeId === 'symbol:consumer',
    );

    expect(consumer?.weakLinkOnly).toBe(true);
  });
});
