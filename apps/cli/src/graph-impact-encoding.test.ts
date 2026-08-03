import {
  aComponent,
  anAnalysis,
  anImpact,
  aRequirement,
  aSpecification,
} from '@impactgraph/test-kit';
import { buildImpactView, renderGraphHtml } from '@impactgraph/workspace-engine';
import { describe, expect, it } from 'vitest';

import type { ImpactLikelihood } from '@impactgraph/domain';
import type { ImpactViewInput } from '@impactgraph/workspace-engine';

// How the impact export ENCODES its two primary readings, and the proof that neither depends on
// colour: likelihood (PRD §13, the thing a reader acts on) and provenance (§3, how the claim was
// produced). Both must survive greyscale, and each must remain legible when the other is constant.
//
// Deliberately NO assertion on what the scoring engine would produce: confidence weighting is
// mid-review, so every number here is a fixture input, never an expectation about its arithmetic.

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

describe('impact export — likelihood reads without colour (PRD §13/§37)', () => {
  const likelihoods: readonly ImpactLikelihood[] = ['required', 'likely', 'possible', 'unlikely'];
  const nodeIds = likelihoods.map((entry) => `file:src/${entry}.ts`);
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis(
        likelihoods.map((likelihood, index) =>
          anImpact({
            nodeId: nodeIds[index] ?? '',
            likelihood,
            confidence: 0.9 - index * 0.2,
          }),
        ),
      ),
      components: new Map(
        likelihoods.map((entry, index) => [nodeIds[index] ?? '', aComponent(entry)]),
      ),
      groupOf: new Map(nodeIds.map((id) => [id, 'Alpha'])),
    }),
  );
  const html = renderGraphHtml(view);

  it('spells every likelihood out as a word and a fraction', () => {
    for (const [badge, filled] of [
      ['REQUIRED', 4],
      ['LIKELY', 3],
      ['POSSIBLE', 2],
      ['UNLIKELY', 1],
    ] as const) {
      expect(html).toContain(`${badge} ${String(filled)}/4`);
    }
  });

  it('draws a four-segment meter whose FILLED COUNT is the encoding, not a shade', () => {
    // one `meter-off` segment appears only if a likelihood below `required` is drawn
    expect(html).toContain('class="meter-on"');
    expect(html).toContain('class="meter-off"');
    const cells = html.match(/<g class="meter" aria-hidden="true">.*?<\/g>/g) ?? [];
    const filledCounts = cells.map((cell) => (cell.match(/meter-on/g) ?? []).length);
    // every meter has exactly four segments, and all four fill levels are present
    for (const cell of cells) {
      expect((cell.match(/meter-o(n|ff)/g) ?? []).length).toBe(4);
    }
    expect(new Set(filledCounts)).toEqual(new Set([1, 2, 3, 4]));
  });

  it('prints confidence as text to two decimals, never as a colour or a bar alone', () => {
    expect(html).toContain('conf 0.90');
    expect(html).toContain('conf 0.30');
  });

  it('carries no colour declaration that any meaning depends on', () => {
    expect(html).not.toMatch(/fill="(?!none|currentColor)[^"]*#/);
    expect(html).not.toMatch(/stroke="(?!none|currentColor)[^"]*#/);
  });
});

describe('impact export — provenance stays distinct from likelihood (PRD §3)', () => {
  const nodeIds = ['file:src/fact.ts', 'file:src/inferred.ts', 'file:src/confirmed.ts'];
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis([
        anImpact({
          nodeId: nodeIds[0] ?? '',
          likelihood: 'required',
          provenance: 'static-analysis',
        }),
        anImpact({ nodeId: nodeIds[1] ?? '', likelihood: 'required', provenance: 'llm-inferred' }),
        anImpact({
          nodeId: nodeIds[2] ?? '',
          likelihood: 'required',
          provenance: 'human-confirmed',
          evidenceIds: [],
        }),
      ]),
      components: new Map(nodeIds.map((id, index) => [id, aComponent(`c${String(index)}`)])),
      groupOf: new Map(nodeIds.map((id) => [id, 'Alpha'])),
    }),
  );
  const html = renderGraphHtml(view);

  it('gives three identically-likely impacts three different borders and badges', () => {
    // all three are REQUIRED, so likelihood cannot be what distinguishes them
    expect(view.nodes.every((node) => node.impact?.likelihood === 'required')).toBe(true);
    expect(html).toContain('file · FACT');
    expect(html).toContain('file · INFERRED');
    expect(html).toContain('file · CONFIRMED');
    // deterministic: square corners, solid
    expect(html).toMatch(/class="node-shape" x="\d+" y="\d+" width="232" height="92" rx="0"/);
    // ai-inferred: rounded corners, dashed
    expect(html).toMatch(
      /class="node-shape" x="\d+" y="\d+" width="232" height="92" rx="12" stroke-width="2" stroke-dasharray="7 5"/,
    );
    // human-confirmed: a second, inset outline
    expect(html).toMatch(/class="node-shape inner" x="\d+" y="\d+" width="226" height="86"/);
  });
});

describe('impact export — requirement attribution and hop counts (PRD §18.4/§18.5)', () => {
  const view = buildImpactView(
    inputOf({
      analysis: anAnalysis(
        [
          anImpact({
            nodeId: 'symbol:src/target.ts#doThing',
            requirementId: 'req-1',
            likelihood: 'required',
            directness: 'direct',
            dependencyPath: ['symbol:src/target.ts#doThing'],
          }),
          anImpact({
            nodeId: 'file:src/far.ts',
            requirementId: 'req-2',
            likelihood: 'possible',
            dependencyPath: [
              'symbol:src/target.ts#doThing',
              'file:src/target.ts',
              'file:src/far.ts',
            ],
            confidenceSignals: [
              { type: 'exact-concept-to-symbol-match', contribution: 0.9, description: 'exact' },
              { type: 'graph-distance', contribution: -0.25, description: 'hop 1' },
              { type: 'graph-distance', contribution: -0.25, description: 'hop 2' },
            ],
          }),
        ],
        {
          warnings: [
            { code: 'unmatched-requirement', message: 'nothing matched', requirementId: 'req-3' },
          ],
        },
      ),
      specification: aSpecification([
        aRequirement('req-1', 'The thing must be done.'),
        aRequirement('req-2', 'A far file matters.'),
        aRequirement('req-3', 'Nothing in the repository matches this.'),
      ]),
      components: new Map([
        ['symbol:src/target.ts#doThing', aComponent('doThing', 'symbol')],
        ['file:src/target.ts', aComponent('target')],
        ['file:src/far.ts', aComponent('far')],
      ]),
      groupOf: new Map([
        ['symbol:src/target.ts#doThing', 'Alpha'],
        ['file:src/target.ts', 'Alpha'],
        ['file:src/far.ts', 'Beta'],
      ]),
      hopEdges: new Map([
        [
          'symbol:src/target.ts#doThing file:src/target.ts',
          { type: 'CONTAINS', provenance: 'static-analysis' },
        ],
        ['file:src/target.ts file:src/far.ts', { type: 'IMPORTS', provenance: 'static-analysis' }],
      ]),
    }),
  );
  const html = renderGraphHtml(view);

  it('distinguishes a direct match from a two-hop claim, in the cell and in the table', () => {
    expect(html).toContain('direct match');
    expect(html).toContain('indirect · 2 hops');
    expect(view.impact?.totals.maxHops).toBe(2);
    expect(view.impact?.totals.directCount).toBe(1);
    expect(view.impact?.totals.indirectCount).toBe(1);
  });

  it('draws the dependency path hop by hop rather than asserting a distance', () => {
    expect(html).toContain('direct match — no traversal');
    // the full path is spelled out, so a two-hop claim can be checked
    expect(html).toContain('symbol:src/target.ts#doThing');
    expect(html).toContain('file:src/far.ts');
    // hops are resolved back to the real graph edge type, not called "depends on"
    expect(html).toContain('IMPORTS ×1');
  });

  it('attributes every impact to a requirement, and names requirements with none', () => {
    expect(html).toContain('<h2 id="requirements-heading">Requirements</h2>');
    expect(html).toContain('The thing must be done.');
    expect(html).toContain('Nothing in the repository matches this.');
    expect(html).toContain('no impacts predicted');
    expect(html).toContain('unmatched-requirement');
    expect(view.impact?.totals.requirementsWithoutImpacts).toBe(1);
    expect(html).toContain('requirements produced no impacts at all');
  });

  it('publishes the §14 contributing signals behind every score', () => {
    expect(html).toContain('Confidence signals (§14)');
    expect(html).toContain('exact-concept-to-symbol-match +0.90');
    expect(html).toContain('graph-distance -0.25');
  });

  it('reports evidence as a count and never publishes an evidence identifier', () => {
    expect(html).not.toContain('ev-1');
    expect(html).toContain('Evidence');
  });
});
