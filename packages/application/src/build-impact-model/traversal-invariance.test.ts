import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactModel } from './build-impact-model.js';

import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  Specification,
} from '@impactgraph/domain';

// Metamorphic invariance (§43.5). A prediction about architecture must not depend on facts that
// carry no architectural meaning: what an edge record happens to be called, or the order concepts
// appear in a sentence. These properties are what make the §41 metrics worth measuring at all —
// a metric computed on an arbitrary subset of candidates measures the subset, not the engine.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, type: string, name: string): GraphNode => {
  const category = type === 'file' || type === 'symbol' ? 'repository' : 'application';
  const result = createGraphNode({ id, category, type, name, path: `src/${name}`, knowledge });
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
    throw new Error(`graph invalid: ${result.error.issues.map((i) => i.message).join(', ')}`);
  }
  return result.value;
};

const specOf = (concepts: readonly string[]): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'T',
    sourceType: 'markdown',
    rawText: 'irrelevant',
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'The system must change something.',
        type: 'functional',
        concepts: [...concepts],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('spec invalid');
  }
  return result.value;
};

const analyze = (
  graph: KnowledgeGraph,
  concepts: readonly string[],
  maxCandidates?: number,
): ImpactAnalysis => {
  const result = buildImpactModel({
    specification: specOf(concepts),
    graph,
    repositorySnapshotId: 'snap-1',
    analysisId: 'analysis-1',
    createdAt: '2026-08-03T10:00:00.000Z',
    ...(maxCandidates === undefined ? {} : { traversal: { maxCandidates } }),
  });
  if (!result.ok) {
    throw new Error(`analysis invalid: ${result.error.issues.map((i) => i.message).join(', ')}`);
  }
  return result.value;
};

/** The comparable shape of a prediction: what the user is shown and told to trust. */
const fingerprint = (analysis: ImpactAnalysis): string[] =>
  analysis.requirementImpacts.map(
    (impact) =>
      `${impact.nodeId}|${impact.likelihood}|${impact.confidence.toFixed(2)}|${impact.directness}|` +
      [...impact.confidenceSignals]
        .map((signal) => signal.type)
        .sort()
        .join('+'),
  );

/**
 * One anchor with 60 dependents, each with its own dependent. Edge ids run OPPOSITE to node ids —
 * `edge-00` carries `file:mid-59` — so a traversal that truncates in discovery order keeps a
 * different set than one that ranks first. That misalignment is the whole point: with edge ids
 * ascending alongside node ids, a discovery-order cap looks correct by coincidence.
 */
const wideGraph = ((edgePrefix: string): KnowledgeGraph => {
  const nodes: GraphNode[] = [node('symbol:hub', 'symbol', 'HubService')];
  const edges: GraphEdge[] = [];
  for (let index = 0; index < 60; index += 1) {
    const pad = String(index).padStart(2, '0');
    const reversed = String(59 - index).padStart(2, '0');
    nodes.push(node(`file:mid-${pad}`, 'file', `mid-${pad}.ts`));
    nodes.push(node(`file:leaf-${pad}`, 'file', `leaf-${pad}.ts`));
    edges.push(edge(`${edgePrefix}-mid-${reversed}`, 'IMPORTS', `file:mid-${pad}`, 'symbol:hub'));
    edges.push(
      edge(`${edgePrefix}-leaf-${reversed}`, 'IMPORTS', `file:leaf-${pad}`, `file:mid-${pad}`),
    );
  }
  return graphOf(nodes, edges);
})('edge');

/** The same graph with every edge renamed, which carries no architectural meaning. */
const renamedWideGraph = ((): KnowledgeGraph => {
  const nodes: GraphNode[] = [node('symbol:hub', 'symbol', 'HubService')];
  const edges: GraphEdge[] = [];
  for (let index = 0; index < 60; index += 1) {
    const pad = String(index).padStart(2, '0');
    nodes.push(node(`file:mid-${pad}`, 'file', `mid-${pad}.ts`));
    nodes.push(node(`file:leaf-${pad}`, 'file', `leaf-${pad}.ts`));
    edges.push(edge(`zz-mid-${pad}`, 'IMPORTS', `file:mid-${pad}`, 'symbol:hub'));
    edges.push(edge(`zz-leaf-${pad}`, 'IMPORTS', `file:leaf-${pad}`, `file:mid-${pad}`));
  }
  return graphOf(nodes, edges);
})();

describe('impact predictions are invariant under meaningless permutations', () => {
  it('does not change when edge records are renamed', () => {
    const original = analyze(wideGraph, ['HubService'], 50);
    const renamed = analyze(renamedWideGraph, ['HubService'], 50);

    expect(fingerprint(renamed)).toEqual(fingerprint(original));
  });

  it('unions the evidence of equally short routes instead of keeping whichever arrived first', () => {
    const graph = graphOf(
      [node('symbol:alpha', 'symbol', 'AlphaService'), node('file:shared', 'file', 'shared.ts')],
      [
        edge('e-calls', 'CALLS', 'symbol:alpha', 'file:shared'),
        edge('e-reads', 'READS_FROM', 'symbol:alpha', 'file:shared'),
      ],
    );
    const impact = analyze(graph, ['AlphaService']).requirementImpacts.find(
      (candidate) => candidate.nodeId === 'file:shared',
    );

    // Two independent relationships prove more than one; a boolean visited set discards the second.
    const signals = impact?.confidenceSignals.map((signal) => signal.type) ?? [];
    expect(signals).toContain('direct-function-call');
    expect(signals).toContain('direct-data-access');
  });

  it('does not let a weak anchor starve a strong one out of the results', () => {
    // 'AaaHelper' sorts before 'ZzzService', so the weak anchor is walked first. Its 40 dependents
    // must not consume a 10-slot budget and leave the exact match unreported.
    const nodes: GraphNode[] = [
      // Matched by name similarity (0.5), not exactly — the weaker of the two anchors.
      node('file:weak-anchor', 'file', 'aaa-helper.ts'),
      node('symbol:strong', 'symbol', 'ZzzService'),
    ];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 40; index += 1) {
      const pad = String(index).padStart(2, '0');
      nodes.push(node(`file:weak-${pad}`, 'file', `weak-${pad}.ts`));
      edges.push(edge(`edge-weak-${pad}`, 'IMPORTS', `file:weak-${pad}`, 'file:weak-anchor'));
    }
    nodes.push(node('file:strong', 'file', 'strong.ts'));
    edges.push(edge('edge-strong', 'IMPORTS', 'file:strong', 'symbol:strong'));

    const analysis = analyze(graphOf(nodes, edges), ['AaaHelper', 'ZzzService'], 10);
    const reached = new Set(analysis.requirementImpacts.map((impact) => impact.nodeId));

    expect(reached).toContain('symbol:strong');
    expect(reached).toContain('file:strong');
  });
});

describe('the candidate cap is an output limit, not a traversal control', () => {
  it('raising the cap appends results without reordering or rescoring the earlier ones', () => {
    const fifty = fingerprint(analyze(wideGraph, ['HubService'], 50));
    const hundred = fingerprint(analyze(wideGraph, ['HubService'], 100));

    expect(fifty).toHaveLength(50);
    expect(hundred.length).toBeGreaterThan(50);
    expect(hundred.slice(0, 50)).toEqual(fifty);
  });

  it('keeps the strongest candidates rather than whichever were discovered first', () => {
    const capped = analyze(wideGraph, ['HubService'], 20);
    const confidences = capped.requirementImpacts.map((impact) => impact.confidence);

    expect(capped.requirementImpacts.some((impact) => impact.nodeId === 'symbol:hub')).toBe(true);
    expect(Math.min(...confidences)).toBeGreaterThanOrEqual(0.65);
  });

  // Traversal returns candidates ordered by (distance, nodeId), which usually resembles strength
  // closely enough to hide a discovery-order cap. Here it does not: both candidates sit one hop
  // out, but the alphabetically-first one carries weaker evidence, so keeping one of them is a
  // direct question about whether the cap ranks or merely truncates.
  it('drops the weaker of two equidistant candidates, not the alphabetically later one', () => {
    const graph = graphOf(
      [
        node('symbol:anchor', 'symbol', 'AnchorService'),
        node('file:aaa', 'file', 'aaa.ts'),
        node('file:zzz', 'file', 'zzz.ts'),
      ],
      [
        // EXTENDS carries no §14 edge signal; IMPORTS contributes direct-import.
        edge('e-1', 'EXTENDS', 'symbol:anchor', 'file:aaa'),
        edge('e-2', 'IMPORTS', 'symbol:anchor', 'file:zzz'),
      ],
    );
    const kept = analyze(graph, ['AnchorService'], 2).requirementImpacts.map(
      (impact) => impact.nodeId,
    );

    expect(kept).toContain('symbol:anchor');
    expect(kept).toContain('file:zzz');
    expect(kept).not.toContain('file:aaa');
  });

  it('reports how much was dropped, not merely that something was', () => {
    const capped = analyze(wideGraph, ['HubService'], 20);
    const cutoff = capped.warnings.find((warning) => warning.code === 'traversal-cutoff');

    expect(cutoff?.message).toMatch(/\d+/);
  });
});
