import {
  aComponent,
  anAnalysis,
  anImpact,
  aRequirement,
  aSpecification,
} from '@impactgraph/test-kit';
import { buildImpactView, renderGraphHtml } from '@impactgraph/workspace-engine';
import { describe, expect, it } from 'vitest';

import type { ImpactViewInput } from '@impactgraph/workspace-engine';

// ADR-0022: the default artifact for an analysis answers "what should I look at", not "what does
// the architecture look like". A 185-node diagram of a 11.5k-node graph, with every weak name
// match listed under it, was architecture wallpaper — nobody made a decision from it.

const NODES = {
  strong: 'file:src/decision/renderer.ts',
  transitive: 'file:src/decision/caller.ts',
  weak: 'file:docs/engineering/renderer-notes.md',
  weakToo: 'file:src/unrelated/renderer-helper.ts',
  supplied: 'file:src/decision/named-by-spec.ts',
};

const components = new Map(
  Object.values(NODES).map((nodeId) => [nodeId, aComponent(nodeId.split('/').pop() ?? nodeId)]),
);

const analysis = () =>
  anAnalysis([
    anImpact({
      nodeId: NODES.strong,
      likelihood: 'required',
      evidenceTypes: ['direct-structural'],
    }),
    anImpact({
      nodeId: NODES.transitive,
      likelihood: 'likely',
      evidenceTypes: ['transitive-structural'],
    }),
    // Weak name matches: the tier that flooded the old artifact.
    anImpact({ nodeId: NODES.weak, likelihood: 'likely', evidenceTypes: ['name-similarity'] }),
    anImpact({
      nodeId: NODES.weakToo,
      likelihood: 'possible',
      evidenceTypes: ['name-similarity'],
    }),
    // Named by the specification: a confirmation is a decision surface whatever its basis.
    // `likely` because the tier ceiling refuses `required` on a name match — the point here is
    // that the specification NAMED it, which keeps it in the decision scope regardless.
    anImpact({
      nodeId: NODES.supplied,
      likelihood: 'likely',
      evidenceTypes: ['name-similarity'],
      evidenceProvenance: 'USER_SUPPLIED',
    }),
  ]);

const inputOf = (scope: ImpactViewInput['scope']): ImpactViewInput => ({
  grouping: 'context',
  analysis: analysis(),
  specification: aSpecification([aRequirement('req-1', 'The renderer must cap its output.')]),
  currentSpecificationVersion: 1,
  resolvedSnapshotId: 'snap-fixture',
  components,
  groupOf: new Map(Object.values(NODES).map((nodeId) => [nodeId, 'Alpha'])),
  hopEdges: new Map(),
  ...(scope === undefined ? {} : { scope }),
});

describe('decision-scoped impact export (ADR-0022)', () => {
  const decision = buildImpactView(inputOf('decision'));
  const full = buildImpactView(inputOf('full'));

  it('draws the strong tier and what the specification named, and nothing weaker', () => {
    const drawn = new Set(decision.nodes.map((node) => node.id));

    expect(drawn.has(NODES.strong)).toBe(true);
    expect(drawn.has(NODES.transitive)).toBe(true);
    expect(drawn.has(NODES.supplied)).toBe(true);
    expect(drawn.has(NODES.weak)).toBe(false);
    expect(drawn.has(NODES.weakToo)).toBe(false);
  });

  it('scopes the tables to the same surfaces as the diagram', () => {
    const listed = decision.impact?.impacts.map((row) => row.nodeId) ?? [];

    expect(listed).toHaveLength(3);
    expect(listed).not.toContain(NODES.weak);
  });

  it('states what the scope excluded rather than implying that was everything', () => {
    const note = decision.impact?.warnings.find((entry) => entry.code === 'decision-scope');

    expect(note?.message).toContain('3 of 5 predicted impacts shown');
    expect(note?.message).toContain('The other 2 are dependency context or name-match leads');
  });

  it('keeps the every-surface view available for the reader who wants it', () => {
    const drawn = new Set(full.nodes.map((node) => node.id));

    expect(drawn.has(NODES.weak)).toBe(true);
    expect(full.impact?.warnings.some((entry) => entry.code === 'decision-scope')).toBe(false);
  });

  it('renders a file small enough to read', () => {
    const decisionHtml = renderGraphHtml(decision);
    const fullHtml = renderGraphHtml(full);

    expect(decisionHtml.length).toBeLessThan(fullHtml.length);
    expect(decisionHtml).toContain('Decision view');
  });
});
