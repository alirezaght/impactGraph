import {
  aComponent,
  anAnalysis,
  anImpact,
  aRequirement,
  aSpecification,
} from '@impactgraph/test-kit';
import { buildImpactView, MAX_VISIBLE_NODES, renderGraphHtml } from '@impactgraph/workspace-engine';
import { describe, expect, it } from 'vitest';

import type { ProposedStructure } from '@impactgraph/domain';
import type { ImpactViewInput } from '@impactgraph/workspace-engine';

// How the impact view BEHAVES on the cases a real analysis cannot produce on demand: absent
// grouping and absent components, a stale snapshot or specification, proposed structure alongside
// current structure, and an analysis large enough to hit the §33 node budget.

const inputOf = (overrides: Partial<ImpactViewInput> = {}): ImpactViewInput => ({
  grouping: 'context',
  analysis: anAnalysis([anImpact({ nodeId: 'file:src/a.ts' })]),
  specification: aSpecification([aRequirement('req-1', 'Something must happen.')]),
  currentSpecificationVersion: 1,
  resolvedSnapshotId: 'snap-fixture',
  components: new Map([['file:src/a.ts', aComponent('a')]]),
  groupOf: new Map([['file:src/a.ts', 'Alpha']]),
  hopEdges: new Map(),
  ...overrides,
});

describe('impact export — absent data reads as absent (§Z5)', () => {
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis([
        anImpact({ nodeId: 'file:src/ghost.ts', likelihood: 'required' }),
        anImpact({ nodeId: 'file:src/a.ts' }),
      ]),
      // `ghost` is cited by the analysis but absent from the resolved graph, and neither node has
      // a group assignment.
      components: new Map([['file:src/a.ts', aComponent('a')]]),
      groupOf: new Map(),
    }),
  );
  const html = renderGraphHtml(view);

  it('labels an unassigned component instead of leaving it blank', () => {
    expect(view.groups.map((group) => group.label)).toEqual(['(no context assigned)']);
    expect(html).toContain('(no context assigned)');
  });

  it('says so when the analysis cites a node the graph no longer contains', () => {
    const ghost = view.nodes.find((node) => node.id === 'file:src/ghost.ts');
    expect(ghost?.impact?.missingFromSnapshot).toBe(true);
    expect(html).toContain('NOT IN SNAPSHOT');
  });

  it('names the grouping in the label for the other two grouping keys too', () => {
    for (const [grouping, label] of [
      ['application', '(no application assigned)'],
      ['package', '(no package assigned)'],
    ] as const) {
      const other = buildImpactView(inputOf({ grouping, groupOf: new Map() }));
      expect(other.groups.map((group) => group.label)).toEqual([label]);
    }
  });
});

describe('impact export — staleness is stated, never silently refreshed (§40.2)', () => {
  it('reports a snapshot mismatch and a superseded specification version', () => {
    const view = buildImpactView(
      inputOf({ resolvedSnapshotId: 'snap-other', currentSpecificationVersion: 4 }),
    );
    expect(view.impact?.snapshotMatches).toBe(false);
    expect(view.impact?.specificationStale).toBe(true);
    const html = renderGraphHtml(view);
    expect(html).toContain('resolved against snap-other, which is a different snapshot');
    expect(html).toContain('The analysis is stale and was not silently refreshed');
  });

  it('says when the analysis has not been approved by a human', () => {
    const draft = buildImpactView(
      inputOf({
        analysis: anAnalysis([anImpact({ nodeId: 'file:src/a.ts' })], { status: 'draft' }),
      }),
    );
    // apostrophes are escaped in the document, so the assertion matches the escaped form
    expect(renderGraphHtml(draft)).toContain(
      'Analysis status is &#39;draft&#39;, not &#39;approved&#39;',
    );
  });
});

describe('impact export — proposed structure is never merged with current (§18.4)', () => {
  const proposedStructure: ProposedStructure = {
    nodes: [
      {
        id: 'proposed:KeyVault',
        name: 'KeyVault',
        category: 'application',
        type: 'service',
        originOptionId: 'opt-1',
        rationale: 'the option introduces a vault boundary',
        provenance: 'llm-inferred',
        evidenceIds: ['ev-1'],
        confidence: 0.6,
        confidenceSignals: [{ type: 'direct-import', contribution: 0.6 }],
      },
    ],
    relationships: [
      {
        id: 'proposed-edge:1',
        sourceId: 'file:src/a.ts',
        targetId: 'proposed:KeyVault',
        sourceKind: 'existing',
        targetKind: 'proposed',
        type: 'DEPENDS_ON',
        status: 'proposed',
        originOptionId: 'opt-1',
        rationale: 'the caller would depend on the new vault',
        provenance: 'llm-inferred',
        evidenceIds: ['ev-1'],
        confidence: 0.6,
        confidenceSignals: [{ type: 'direct-import', contribution: 0.6 }],
      },
    ],
  };
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis([anImpact({ nodeId: 'file:src/a.ts' })], {
        architecturalOptions: [
          { id: 'opt-1', title: 'Introduce a vault', description: 'x', affectedNodeIds: [] },
        ],
        proposedStructure,
      }),
    }),
  );
  const html = renderGraphHtml(view);

  it('keeps proposed components out of every real group', () => {
    expect(view.groups.map((group) => group.label)).toContain(
      'Proposed structure (not in the repository)',
    );
    const proposedNode = view.nodes.find((node) => node.id === 'proposed:KeyVault');
    expect(proposedNode?.proposed).toBe(true);
    expect(proposedNode?.impact).toBeUndefined();
    expect(proposedNode?.groupId).toBe('Proposed structure (not in the repository)');
  });

  it('aggregates proposed relationships separately and marks them in the model', () => {
    const statuses = view.edges.map((edge) => edge.status);
    expect(statuses).toContain('proposed');
    // no bucket ever mixes the two
    for (const edge of view.edges) {
      expect(['current', 'proposed']).toContain(edge.status);
    }
  });

  it('uses the long dash, a source-end marker and the [PROPOSED] word — three channels', () => {
    expect(html).toContain('stroke-dasharray="14 6"');
    expect(html).toContain('marker-start="url(#arrow-proposed-source)"');
    expect(html).toContain('[PROPOSED]');
    // provenance keeps its own channel on a proposed edge: the target arrowhead still says inferred
    expect(html).toContain('marker-end="url(#arrow-inferred)"');
  });

  it('lists proposed structure in its own tables, with the option that implies it', () => {
    expect(html).toContain('Proposed components [PROPOSED]');
    expect(html).toContain('Proposed relationships [PROPOSED]');
    expect(html).toContain('the option introduces a vault boundary');
    expect(html).toContain('opt-1');
    expect(html).toContain('would be created');
  });
});

describe('impact export — §33 budget is announced, never silent', () => {
  const total = 260;
  const nodeIds = Array.from(
    { length: total },
    (_, index) => `file:src/svc-${String(index).padStart(3, '0')}.ts`,
  );
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis(
        nodeIds.map((nodeId, index) =>
          anImpact({
            nodeId,
            // the strongest claims must be the ones that survive the cap
            likelihood: index < 20 ? 'required' : 'possible',
          }),
        ),
      ),
      components: new Map(nodeIds.map((id, index) => [id, aComponent(`svc-${String(index)}`)])),
      groupOf: new Map(nodeIds.map((id, index) => [id, `ctx-${String(index % 4)}`])),
    }),
  );

  it('caps drawn boxes at the shared budget, counting groups against it', () => {
    expect(view.budget.maxVisibleNodes).toBe(MAX_VISIBLE_NODES);
    expect(view.nodes).toHaveLength(MAX_VISIBLE_NODES - 4);
    expect(view.budget.truncated).toBe(true);
  });

  it('keeps the strongest claims rather than an arbitrary slice', () => {
    const drawnRequired = view.nodes.filter((node) => node.impact?.likelihood === 'required');
    expect(drawnRequired).toHaveLength(20);
  });

  it('states the truncation in words, and still lists every impact', () => {
    const html = renderGraphHtml(view);
    expect(html).toContain(`Showing 196 of ${String(total)} components`);
    expect(html).toContain('64 components are not drawn');
    expect(html).toContain('capped at 200 nodes (PRD §33)');
    expect(html).toContain('every impact is still listed in the Impacts table');
    expect(view.impact?.impacts).toHaveLength(total);
    expect(view.impact?.impacts.filter((entry) => !entry.drawn)).toHaveLength(64);
  });
});
