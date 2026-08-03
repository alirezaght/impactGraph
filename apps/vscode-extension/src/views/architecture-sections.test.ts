import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  ARCHITECTURE_SECTIONS,
  UNASSIGNED_CONTEXT,
  componentsInContext,
  containedChildren,
  contextGroups,
  isNodeItem,
  sectionChildren,
  sectionItems,
} from './architecture-sections.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// PRD §18.6 — the section projection. Every assertion here is about WHICH nodes a section owns
// and what an empty section says; nothing about VS Code, so it runs in the `extension` project.

const envelope = (): Parameters<typeof createGraphNode>[0]['knowledge'] => ({
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
});

const node = (id: string, category: string, type: string, path?: string): GraphNode => {
  const created = createGraphNode({
    id,
    name: id,
    category,
    type,
    ...(path === undefined ? {} : { path }),
    knowledge: envelope(),
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${id}`);
  }
  return created.value;
};

const contains = (sourceId: string, targetId: string): GraphEdge => {
  const created = createGraphEdge({
    id: `${sourceId}->${targetId}`,
    type: 'CONTAINS',
    sourceId,
    targetId,
    knowledge: envelope(),
  });
  if (!created.ok) {
    throw new Error('bad fixture edge');
  }
  return created.value;
};

const NODES = [
  node('package:web', 'repository', 'package', 'apps/web/package.json'),
  node('package:api', 'repository', 'package', 'services/api/package.json'),
  node('file:a', 'repository', 'file', 'apps/web/a.ts'),
  node('symbol:a', 'repository', 'symbol', 'apps/web/a.ts'),
  node('service:billing', 'application', 'service'),
  node('topic:deals', 'integration', 'topic'),
  node('docker:web', 'infrastructure', 'docker-image', 'apps/web/Dockerfile'),
  node('class:Ignored', 'application', 'class', 'apps/web/a.ts'),
];

const graphOf = (): KnowledgeGraph => {
  const created = createKnowledgeGraph(NODES, [
    contains('package:web', 'file:a'),
    contains('file:a', 'symbol:a'),
  ]);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

describe('architecture sections (PRD §18.6)', () => {
  const graph = graphOf();
  const contexts = new Map([['package:web', 'Deal Management']]);

  it('opens on the five §18.6 sections, in a stable order', () => {
    expect(sectionItems().map((section) => section.id)).toEqual([
      'applications',
      'contexts',
      'components',
      'integrations',
      'infrastructure',
    ]);
    expect(ARCHITECTURE_SECTIONS).toHaveLength(5);
  });

  it('selects each section on the node vocabulary, never by guessing', () => {
    const members = (id: string): string[] =>
      sectionChildren(graph, contexts, id).map((item) =>
        isNodeItem(item) ? item.node.id : item.id,
      );
    expect(members('applications')).toEqual(['service:billing']);
    expect(members('components')).toEqual(['package:api', 'package:web']);
    expect(members('integrations')).toEqual(['topic:deals']);
    expect(members('infrastructure')).toEqual(['docker:web']);
    // A `class` is application-CATEGORY but not an application; it stays out of the section.
    expect(members('applications')).not.toContain('class:Ignored');
  });

  it('groups components by effective context and names the unassigned bucket', () => {
    const groups = contextGroups(graph, contexts);
    expect(groups.map((group) => group.label)).toEqual(['Deal Management', UNASSIGNED_CONTEXT]);
    expect(groups.map((group) => group.detail)).toEqual(['1 component', '1 component']);
    expect(
      componentsInContext(graph, contexts, 'context:Deal Management').map((item) => item.node.id),
    ).toEqual(['package:web']);
    expect(
      componentsInContext(graph, contexts, `context:${UNASSIGNED_CONTEXT}`).map(
        (item) => item.node.id,
      ),
    ).toEqual(['package:api']);
  });

  it('renders no context groups at all when nothing has a context', () => {
    expect(contextGroups(graph, new Map())).toEqual([]);
    const children = sectionChildren(graph, new Map(), 'contexts');
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ kind: 'note', detail: 'none detected' });
  });

  it('states absence explicitly instead of hiding an empty section (§43.6)', () => {
    const empty = createKnowledgeGraph([node('package:solo', 'repository', 'package')], []);
    if (!empty.ok) {
      throw new Error('bad fixture graph');
    }
    for (const id of ['applications', 'integrations', 'infrastructure']) {
      const children = sectionChildren(empty.value, new Map(), id);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'note' });
      expect((children[0] as { readonly label: string }).label.length).toBeGreaterThan(0);
    }
  });

  it('drills down component → file → symbol and stops at the symbol', () => {
    const component = { kind: 'package' as const, node: NODES[0] as GraphNode };
    const files = containedChildren(graph, component);
    expect(files.map((item) => [item.kind, item.node.id])).toEqual([['file', 'file:a']]);
    const symbols = containedChildren(graph, files[0] as (typeof files)[number]);
    expect(symbols.map((item) => [item.kind, item.node.id])).toEqual([['symbol', 'symbol:a']]);
    expect(containedChildren(graph, symbols[0] as (typeof symbols)[number])).toEqual([]);
  });

  it('never reports a group item as a node item', () => {
    expect(sectionItems().some(isNodeItem)).toBe(false);
    expect(isNodeItem({ kind: 'package', node: NODES[0] as GraphNode })).toBe(true);
    expect(isNodeItem({ kind: 'section', id: 'x', label: 'X', detail: '' })).toBe(false);
  });
});
