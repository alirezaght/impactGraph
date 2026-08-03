import { performance } from 'node:perf_hooks';

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { describe, expect, it } from 'vitest';

import { MAX_VISIBLE_NODES, planDisclosure } from './disclosure.js';
import { buildElements } from './elements.js';
import { DEFAULT_FILTERS, applyNodeFilters } from './filters.js';
import { graphStylesheet, layoutOptions } from './style.js';

import type {
  ImpactGraphDto,
  ImpactGraphEdgeDto,
  ImpactGraphNodeDto,
} from '@impactgraph/contracts';
import type { ElementDefinition, LayoutOptions } from 'cytoscape';

// PRD §33 / performance-budgets.md §3 — B5 is a COUNT budget (< 200 visible nodes) and it was
// already unit-tested. This file measures the two costs that count buys us, because a cap nobody
// timed is a guess:
//
//   P1  first-paint pipeline: filter → progressive disclosure → Cytoscape element construction,
//       over a 5,000-node analysis. This is everything that happens on the UI thread between a
//       `host/graph` message arriving and Cytoscape being handed elements.
//   P2  layout: a real headless Cytoscape core running the shipped stylesheet and the shipped
//       `cose` options over the capped element set.
//
// Headless (not jsdom-rendered) is deliberate and is the honest thing to measure here: jsdom has
// no canvas, so a painted frame cannot be timed at all in this lane, and inventing a number would
// be worse than measuring less. Layout + style resolution is the algorithmic cost that scales
// with node count; rasterising ~200 boxes is not what makes a graph view slow.
//
// RECORDED BASELINE (2026-08-02, Apple Silicon / darwin-arm64, Node 22, 5 runs, median of 5):
//   P1 pipeline, 5,000 nodes → 7.7 ms median, 15.1 ms worst
//   P2 fcose layout, 201 elements (200 capped nodes + compound parents + surviving edges)
//                              → 466.8 ms median, 476.0 ms worst
// Thresholds below are regression guards with deliberate headroom over those medians — CI runners
// are too noisy for millisecond gates (performance-budgets.md §3) and a flaky gate would be worse
// than no gate. A real regression (an un-capped render, a re-layout per message, an O(n²) filter)
// blows past them by orders of magnitude; jitter does not.
//
// Proposing B11/B12 as formal entries in performance-budgets.md is performance-scalability's
// call, not ours; these constants are this suite's contract until then.

const ANALYSIS_NODES = 5_000;
const RUNS = 5;

/** P1: pipeline over a 5,000-node analysis (~20× the recorded median). */
const PIPELINE_BUDGET_MS = 150;
/** P2: `cose` layout + style resolution over the capped graph (~4× the recorded median). */
const LAYOUT_BUDGET_MS = 2_000;

const CATEGORIES = ['deterministic', 'ai-inferred', 'human-confirmed'] as const;
const LIKELIHOODS = ['required', 'likely', 'possible', 'unlikely'] as const;
const IMPACT_TYPES = ['logic-change', 'contract-change', 'data-change', 'config-change'] as const;
const CONTEXTS = ['Deal Management', 'Search', 'Billing', 'Infrastructure'] as const;

/** Deterministic (index-seeded) fixture — no randomness, so runs are comparable. */
const syntheticNodes = (count: number): ImpactGraphNodeDto[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `node-${String(index)}`,
    name: `Component${String(index)}`,
    kind: index % 7 === 0 ? ('dependency' as const) : ('impact' as const),
    requirementIds: [`req-${String(index % 12)}`],
    likelihood: LIKELIHOODS[index % LIKELIHOODS.length],
    impactType: IMPACT_TYPES[index % IMPACT_TYPES.length],
    directness: index % 3 === 0 ? ('direct' as const) : ('indirect' as const),
    confidence: (index % 100) / 100,
    knowledgeCategory: CATEGORIES[index % CATEGORIES.length],
    // A quarter of the graph has no assigned context — the §18.4 default must survive that.
    ...(index % 4 === 0 ? {} : { context: CONTEXTS[index % CONTEXTS.length] }),
    filePath: `src/area-${String(index % 40)}/component-${String(index)}.ts`,
  }));

/** A dense web: every node reaches the next two, so edge filtering has real work to do. */
const syntheticEdges = (count: number): ImpactGraphEdgeDto[] =>
  Array.from({ length: count }, (_unused, index) => index)
    .flatMap((index) => [index + 1, index + 2].map((offset) => [index, offset % count] as const))
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({
      id: `edge-${String(from)}-${String(to)}`,
      sourceId: `node-${String(from)}`,
      targetId: `node-${String(to)}`,
      label: 'depends on',
      directness: from % 2 === 0 ? ('direct' as const) : ('indirect' as const),
    }));

const graph: ImpactGraphDto = {
  schemaVersion: 1,
  status: 'loaded',
  analysisId: 'an-bench',
  requirements: Array.from({ length: 12 }, (_unused, index) => ({
    id: `req-${String(index)}`,
    statement: `Requirement ${String(index)}`,
  })),
  nodes: syntheticNodes(ANALYSIS_NODES),
  edges: syntheticEdges(ANALYSIS_NODES),
  totalNodeCount: ANALYSIS_NODES,
  warnings: [],
};

const requirementLabels = new Map(
  graph.requirements.map((requirement) => [requirement.id, requirement.statement]),
);

const buildOnce = (): ElementDefinition[] => {
  const filters = DEFAULT_FILTERS;
  const plan = planDisclosure({
    nodes: applyNodeFilters(graph.nodes, filters),
    filters,
    requirementLabels,
    // Two contexts expanded: the realistic worst case, where the cap is actually saturated.
    expandedGroupIds: new Set(['group:context:Deal Management', 'group:context:Search']),
  });
  return buildElements({ graph, plan, filters, requirementLabels });
};

interface Timing {
  readonly median: number;
  readonly worst: number;
}

const summarize = (samples: readonly number[]): Timing => {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
  };
};

const report = (label: string, timing: Timing, budget: number): void => {
  process.stdout.write(
    `      ${label}: median ${timing.median.toFixed(1)} ms, worst ${timing.worst.toFixed(1)} ms ` +
      `(budget ${String(budget)} ms)\n`,
  );
};

// The benchmark must measure the layout we actually ship (fcose, ADR-0005), so the plugin is
// registered here too — otherwise Cytoscape falls back and the number describes nothing.
cytoscape.use(fcose);

/** One headless layout pass over the shipped stylesheet and layout options. */
const layoutOnce = async (elements: readonly ElementDefinition[]): Promise<number> => {
  const core = cytoscape({ headless: true, styleEnabled: true, style: graphStylesheet });
  core.add([...elements]);
  const started = performance.now();
  await new Promise<void>((resolve) => {
    core.one('layoutstop', () => {
      resolve();
    });
    // `reducedMotion: true` = no animation, so the measurement is layout, not a 300 ms tween.
    core
      .layout({
        ...layoutOptions(true),
        nodeDimensionsIncludeLabels: false,
      } as unknown as LayoutOptions)
      .run();
  });
  const elapsed = performance.now() - started;
  core.destroy();
  return elapsed;
};

describe('graph render/layout performance (PRD §33 B5)', () => {
  it(
    'builds the capped element set from a 5,000-node analysis inside the pipeline budget',
    { timeout: 120_000 },
    () => {
      const samples: number[] = [];
      let elements: ElementDefinition[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        elements = buildOnce();
        samples.push(performance.now() - started);
      }
      const timing = summarize(samples);
      report(`P1 pipeline (${String(ANALYSIS_NODES)} nodes)`, timing, PIPELINE_BUDGET_MS);

      const nodeElements = elements.filter(
        (element) => element.classes?.includes('impact-node') ?? false,
      );
      // The cap is what the budget is FOR: assert it held on the measured run.
      expect(nodeElements.length).toBeLessThanOrEqual(MAX_VISIBLE_NODES);
      expect(nodeElements.length).toBeGreaterThan(0);
      expect(timing.median).toBeLessThan(PIPELINE_BUDGET_MS);
    },
  );

  it('lays out the capped graph inside the layout budget', { timeout: 120_000 }, async () => {
    const elements = buildOnce();
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      samples.push(await layoutOnce(elements));
    }
    const timing = summarize(samples);
    report(`P2 fcose layout (${String(elements.length)} elements)`, timing, LAYOUT_BUDGET_MS);
    expect(timing.median).toBeLessThan(LAYOUT_BUDGET_MS);
  });
});
