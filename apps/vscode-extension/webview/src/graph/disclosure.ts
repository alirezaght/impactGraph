import { groupFor } from './filters.js';

import type { GraphFilters, GroupAssignment } from './filters.js';
import type { GraphViewNode } from './proposed.js';

// PRD §33 + §43.1 — the visible-node budget and progressive disclosure. Past the budget the view
// collapses to group level and SAYS SO ("showing 180 of 412 nodes", "312 hidden — expand a
// group"). It never freezes, and it never truncates silently.

export const MAX_VISIBLE_NODES = 200;

const LIKELIHOOD_RANK: Readonly<Record<string, number>> = {
  required: 0,
  likely: 1,
  possible: 2,
  unlikely: 3,
};

/** Rank by kind: impacts, then the proposed delta, then plain dependency-path hops. */
const KIND_RANK: Readonly<Record<string, number>> = { impact: 0, proposed: 1, dependency: 2 };

/** Most-certain impacts first, then highest confidence; dependency hops come last. */
const priority = (node: GraphViewNode): [number, number, number] => [
  KIND_RANK[node.kind] ?? 3,
  LIKELIHOOD_RANK[node.likelihood ?? ''] ?? 4,
  -(node.confidence ?? 0),
];

const byPriority = (left: GraphViewNode, right: GraphViewNode): number => {
  const a = priority(left);
  const b = priority(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || left.name.localeCompare(right.name);
};

export interface CollapsedGroup extends GroupAssignment {
  readonly hiddenCount: number;
}

export interface DisclosurePlan {
  readonly visibleNodes: readonly GraphViewNode[];
  readonly groups: readonly GroupAssignment[];
  readonly collapsedGroups: readonly CollapsedGroup[];
  /** Nodes matching the filters but not rendered. */
  readonly hiddenCount: number;
  /** Nodes matching the filters (the "of M" in "showing N of M"). */
  readonly matchedCount: number;
  /** True when the budget forced the collapse — drives the visible degradation notice. */
  readonly budgetExceeded: boolean;
}

export interface DisclosureInput {
  readonly nodes: readonly GraphViewNode[];
  readonly filters: GraphFilters;
  readonly requirementLabels: ReadonlyMap<string, string>;
  readonly expandedGroupIds: ReadonlySet<string>;
}

const groupsOf = (input: DisclosureInput): Map<string, GraphViewNode[]> => {
  const byGroup = new Map<string, GraphViewNode[]>();
  for (const node of input.nodes) {
    const group = groupFor(node, input.filters.groupBy, input.requirementLabels);
    byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), node]);
  }
  return byGroup;
};

const labelsOf = (input: DisclosureInput): Map<string, GroupAssignment> => {
  const labels = new Map<string, GroupAssignment>();
  for (const node of input.nodes) {
    const group = groupFor(node, input.filters.groupBy, input.requirementLabels);
    labels.set(group.id, group);
  }
  return labels;
};

/**
 * Under the budget everything is shown. Over it, only explicitly expanded groups render their
 * members, and the remaining budget is spent on the highest-priority nodes.
 */
export const planDisclosure = (
  input: DisclosureInput,
  cap: number = MAX_VISIBLE_NODES,
): DisclosurePlan => {
  const byGroup = groupsOf(input);
  const labels = labelsOf(input);
  const matchedCount = input.nodes.length;
  const budgetExceeded = matchedCount > cap;
  const candidates = budgetExceeded
    ? [...byGroup.entries()]
        .filter(([id]) => input.expandedGroupIds.has(id))
        .flatMap(([, members]) => members)
    : [...input.nodes];
  const visibleNodes = [...candidates].sort(byPriority).slice(0, cap);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const collapsedGroups = [...byGroup.entries()]
    .map(([id, members]) => ({
      ...(labels.get(id) ?? { id, label: id }),
      hiddenCount: members.filter((node) => !visibleIds.has(node.id)).length,
    }))
    .filter((group) => group.hiddenCount > 0);
  return {
    visibleNodes,
    groups: [...labels.values()],
    collapsedGroups,
    hiddenCount: matchedCount - visibleNodes.length,
    matchedCount,
    budgetExceeded,
  };
};

/** The user-facing sentence. Always rendered — the count is never implied by the picture. */
export const disclosureSummary = (plan: DisclosurePlan, totalNodeCount: number): string => {
  const base = `Showing ${String(plan.visibleNodes.length)} of ${String(plan.matchedCount)} matching nodes (${String(totalNodeCount)} in the analysis).`;
  if (plan.hiddenCount === 0) {
    return base;
  }
  return `${base} ${String(plan.hiddenCount)} hidden — expand a group or narrow the filters.`;
};
