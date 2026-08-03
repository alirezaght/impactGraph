import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Story 7.4 / PRD §18.6 — the architecture view's first-class sections (applications, contexts,
// components, integrations, infrastructure). Pure projection over the persisted graph plus the
// §Z5 overlay's effective context per component: this module decides WHAT belongs in a section,
// `architecture-tree.ts` decides how it renders.
//
// Nothing is inferred here. Sections select on the node vocabulary the indexer already assigned
// (§12.1 `type`/`category`), a component with no assigned context lands in an explicit
// "no context assigned" bucket rather than being guessed into one from its path, and a section
// with nothing in it says so instead of disappearing (§43.6).

export type NodeItemKind =
  'application' | 'integration' | 'infrastructure' | 'package' | 'file' | 'symbol';

export interface ArchitectureNodeItem {
  readonly kind: NodeItemKind;
  readonly node: GraphNode;
}

export interface ArchitectureGroupItem {
  /** `note` is the explicit-absence row; it is never selectable and owns no graph node. */
  readonly kind: 'section' | 'context' | 'note';
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export type ArchitectureItem = ArchitectureNodeItem | ArchitectureGroupItem;

export const isNodeItem = (item: ArchitectureItem): item is ArchitectureNodeItem => 'node' in item;

export const UNASSIGNED_CONTEXT = 'no context assigned';

const CONTEXT_PREFIX = 'context:';
const COMPONENT_TYPES = new Set(['package', 'workspace']);
const APPLICATION_TYPES = new Set(['application', 'service']);

/** What one level down means, per parent kind. `symbol` is the leaf of the §18.4 hierarchy. */
const CHILD_KIND: Readonly<Record<NodeItemKind, NodeItemKind | undefined>> = {
  application: 'file',
  integration: 'file',
  infrastructure: 'file',
  package: 'file',
  file: 'symbol',
  symbol: undefined,
};

export interface SectionSpec {
  readonly id: string;
  readonly label: string;
  /** Rendered as the section's only child when nothing matches — absence is stated, not implied. */
  readonly emptyHint: string;
}

export const ARCHITECTURE_SECTIONS: readonly SectionSpec[] = [
  {
    id: 'applications',
    label: 'Applications',
    emptyHint: 'no application or service nodes in this index',
  },
  {
    id: 'contexts',
    label: 'Contexts',
    emptyHint: 'no component has an assigned context yet — use "Assign to Context"',
  },
  {
    id: 'components',
    label: 'Components',
    emptyHint: 'no package or workspace nodes in this index',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    emptyHint: 'no queue, topic, webhook or external-API nodes in this index',
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    emptyHint: 'no infrastructure nodes in this index',
  },
];

export const sectionItems = (): ArchitectureGroupItem[] =>
  ARCHITECTURE_SECTIONS.map((section) => ({
    kind: 'section',
    id: section.id,
    label: section.label,
    detail: 'section',
  }));

const byName = (left: ArchitectureNodeItem, right: ArchitectureNodeItem): number =>
  left.node.name.localeCompare(right.node.name);

const nodesWhere = (
  graph: KnowledgeGraph,
  kind: NodeItemKind,
  keep: (node: GraphNode) => boolean,
): ArchitectureNodeItem[] =>
  [...graph.nodes.values()]
    .filter(keep)
    .map((node) => ({ kind, node }))
    .sort(byName);

/** §18.4 "component" level: the packages and workspaces the indexer found. */
export const componentItems = (graph: KnowledgeGraph): ArchitectureNodeItem[] =>
  nodesWhere(graph, 'package', (node) => COMPONENT_TYPES.has(node.type));

const contextOf = (contexts: ReadonlyMap<string, string>, nodeId: string): string =>
  contexts.get(nodeId) ?? UNASSIGNED_CONTEXT;

/**
 * One group per effective context, plus the unassigned bucket when something falls in it. When
 * NOTHING has a context the section is empty on purpose — a single "no context assigned" group
 * would look like a finding rather than an unanswered question.
 */
export const contextGroups = (
  graph: KnowledgeGraph,
  contexts: ReadonlyMap<string, string>,
): ArchitectureGroupItem[] => {
  const counts = new Map<string, number>();
  for (const item of componentItems(graph)) {
    const label = contextOf(contexts, item.node.id);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if ([...counts.keys()].every((label) => label === UNASSIGNED_CONTEXT)) {
    return [];
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, count]) => ({
      kind: 'context' as const,
      id: `${CONTEXT_PREFIX}${label}`,
      label,
      detail: `${String(count)} component${count === 1 ? '' : 's'}`,
    }));
};

export const componentsInContext = (
  graph: KnowledgeGraph,
  contexts: ReadonlyMap<string, string>,
  groupId: string,
): ArchitectureNodeItem[] => {
  const label = groupId.slice(CONTEXT_PREFIX.length);
  return componentItems(graph).filter((item) => contextOf(contexts, item.node.id) === label);
};

const membersOf = (
  graph: KnowledgeGraph,
  contexts: ReadonlyMap<string, string>,
  sectionId: string,
): ArchitectureItem[] => {
  switch (sectionId) {
    case 'applications':
      return nodesWhere(graph, 'application', (node) => APPLICATION_TYPES.has(node.type));
    case 'contexts':
      return contextGroups(graph, contexts);
    case 'components':
      return componentItems(graph);
    case 'integrations':
      return nodesWhere(graph, 'integration', (node) => node.category === 'integration');
    case 'infrastructure':
      return nodesWhere(graph, 'infrastructure', (node) => node.category === 'infrastructure');
    default:
      return [];
  }
};

export const sectionChildren = (
  graph: KnowledgeGraph,
  contexts: ReadonlyMap<string, string>,
  sectionId: string,
): ArchitectureItem[] => {
  const members = membersOf(graph, contexts, sectionId);
  if (members.length > 0) {
    return members;
  }
  const spec = ARCHITECTURE_SECTIONS.find((entry) => entry.id === sectionId);
  return spec === undefined
    ? []
    : [{ kind: 'note', id: `${sectionId}:empty`, label: spec.emptyHint, detail: 'none detected' }];
};

/** Graph nodes this one CONTAINS, one level down. */
export const containedChildren = (
  graph: KnowledgeGraph,
  item: ArchitectureNodeItem,
): ArchitectureNodeItem[] => {
  const kind = CHILD_KIND[item.kind];
  if (kind === undefined) {
    return [];
  }
  const children: ArchitectureNodeItem[] = [];
  for (const edgeId of graph.outgoing.get(item.node.id) ?? []) {
    const edge = graph.edges.get(edgeId);
    const child = edge?.type === 'CONTAINS' ? graph.nodes.get(edge.targetId) : undefined;
    if (child !== undefined) {
      children.push({ kind, node: child });
    }
  }
  return children.sort(byName);
};

export const hasContainedChildren = (graph: KnowledgeGraph, item: ArchitectureNodeItem): boolean =>
  containedChildren(graph, item).length > 0;
