import { createGraphEdge, createGraphNode } from '@impactgraph/domain';
import { buildGraphView, MAX_VISIBLE_NODES, renderGraphHtml } from '@impactgraph/workspace-engine';
import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode, KnowledgeEnvelopeInput } from '@impactgraph/domain';
import type { GraphViewInput } from '@impactgraph/workspace-engine';

// Renderer-level tests over hand-built graphs — the cases a small fixture repository cannot
// produce: a graph large enough to hit the §33 node budget, and one carrying all three §3
// knowledge categories at once so the visual encoding can be checked node by node.

const envelopeFor = (provenance: string): KnowledgeEnvelopeInput => ({
  provenance,
  evidenceIds: provenance === 'human-confirmed' ? [] : ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
});

const node = (id: string, provenance = 'static-analysis'): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'application',
    type: 'service',
    name: id,
    path: `src/${id}.ts`,
    knowledge: envelopeFor(provenance),
  });
  if (!result.ok) {
    throw new Error(`fixture node ${id} invalid`);
  }
  return result.value;
};

const edge = (id: string, sourceId: string, targetId: string, provenance: string): GraphEdge => {
  const result = createGraphEdge({
    id,
    type: 'IMPORTS',
    sourceId,
    targetId,
    knowledge: envelopeFor(provenance),
  });
  if (!result.ok) {
    throw new Error(`fixture edge ${id} invalid`);
  }
  return result.value;
};

const viewOf = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  groupOf: ReadonlyMap<string, string>,
): GraphViewInput => ({
  snapshotId: 'snap-fixture',
  grouping: 'context',
  nodes,
  edges,
  groupOf,
});

describe('graph export budget (PRD §33)', () => {
  const total = 260;
  const nodes = Array.from({ length: total }, (_, index) =>
    node(`svc-${String(index).padStart(3, '0')}`),
  );
  const groupOf = new Map(nodes.map((entry, index) => [entry.id, `ctx-${index % 4}`]));
  const view = buildGraphView(viewOf(nodes, [], groupOf));

  it('reuses the webview node cap rather than inventing a second budget', () => {
    expect(MAX_VISIBLE_NODES).toBe(200);
    expect(view.budget.maxVisibleNodes).toBe(200);
  });

  it('caps drawn boxes at the budget, counting groups against it', () => {
    expect(view.groups).toHaveLength(4);
    expect(view.nodes).toHaveLength(MAX_VISIBLE_NODES - 4);
    expect(view.budget.architectureNodes).toBe(total);
    expect(view.budget.hiddenNodes).toBe(total - (MAX_VISIBLE_NODES - 4));
    expect(view.budget.truncated).toBe(true);
  });

  it('announces the truncation in words, with both numbers', () => {
    const html = renderGraphHtml(view);
    expect(html).toContain('Showing 196 of 260 architecture-level nodes');
    expect(html).toContain('64 architecture-level nodes are not drawn');
    expect(html).toContain('capped at 200 nodes (PRD §33)');
    expect(html).toContain('Nothing is silently dropped');
  });

  it('spreads the budget across groups instead of letting one group consume it', () => {
    for (const group of view.groups) {
      expect(group.shownNodes).toBeGreaterThan(0);
      expect(group.totalNodes).toBe(65);
      expect(group.shownNodes + group.hiddenNodes).toBe(group.totalNodes);
    }
  });
});

describe('graph export knowledge categories (PRD §3 / §37)', () => {
  const nodes = [
    node('deterministic-service', 'static-analysis'),
    node('inferred-service', 'llm-inferred'),
    node('confirmed-service', 'human-confirmed'),
  ];
  const groupOf = new Map([
    ['deterministic-service', 'Alpha'],
    ['inferred-service', 'Beta'],
    ['confirmed-service', 'Gamma'],
  ]);
  const edges = [
    edge('e-1', 'deterministic-service', 'inferred-service', 'static-analysis'),
    edge('e-2', 'inferred-service', 'confirmed-service', 'llm-inferred'),
    edge('e-3', 'confirmed-service', 'deterministic-service', 'human-confirmed'),
  ];
  const view = buildGraphView(viewOf(nodes, edges, groupOf));
  const html = renderGraphHtml(view);

  it('renders one arrow per category and never merges two categories into one', () => {
    expect(view.edges).toHaveLength(3);
    expect(view.edges.map((entry) => entry.knowledgeCategory).sort()).toEqual([
      'ai-inferred',
      'deterministic',
      'human-confirmed',
    ]);
    for (const marker of ['arrow-fact', 'arrow-inferred', 'arrow-confirmed']) {
      expect(html).toContain(`marker-end="url(#${marker})"`);
    }
  });

  it('gives each category a text badge, so the encoding survives greyscale', () => {
    for (const badge of ['FACT', 'INFERRED', 'CONFIRMED']) {
      expect(html).toContain(`· ${badge}<`);
    }
  });

  it('gives each category a distinct shape and stroke, not just a distinct colour', () => {
    // deterministic: square corners, solid
    expect(html).toMatch(/class="node-shape" x="\d+" y="\d+" width="176" height="52" rx="0"/);
    // ai-inferred: rounded corners, dashed
    expect(html).toMatch(
      /class="node-shape" x="\d+" y="\d+" width="176" height="52" rx="12" stroke-width="2" stroke-dasharray="7 5"/,
    );
    // human-confirmed: a second, inset outline
    expect(html).toMatch(/class="node-shape inner" x="\d+" y="\d+" width="170" height="46"/);
  });

  it('carries no colour declaration that meaning depends on', () => {
    // the palette is greyscale and lives in variables; no per-category colour anywhere
    expect(html).not.toMatch(/fill="(?!none|currentColor)[^"]*#/);
    expect(html).not.toMatch(/stroke="(?!none|currentColor)[^"]*#/);
  });

  it('lists every drawn node and relationship in text form as well', () => {
    for (const entry of nodes) {
      expect(html).toContain(`<code>src/${entry.name}.ts</code>`);
    }
    expect(html).toContain('IMPORTS ×1');
  });
});
