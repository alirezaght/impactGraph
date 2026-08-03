import type { GraphViewNode } from './graph-view-model.js';

// The §33 first-paint budget, shared by both view sources so there is exactly one cap and exactly
// one selection policy. Neither builder may invent a second budget, and neither may drop nodes
// silently — what is not drawn is always counted and stated in words.

/**
 * Biggest groups first, alphabetical on ties — a total order, so selection is reproducible and the
 * rendered file is byte-identical on a re-export.
 */
export const rankGroupIds = (totals: ReadonlyMap<string, number>): string[] =>
  [...totals.entries()]
    .sort(([aId, a], [bId, b]) => b - a || aId.localeCompare(bId))
    .map(([id]) => id);

/**
 * Round-robin one member per group until the budget runs out, so a single enormous group cannot
 * consume the whole picture and leave every other group empty. Each queue is expected to be
 * pre-sorted by its caller's notion of priority: name for the architecture view, strongest
 * likelihood for the impact view.
 */
export const selectRoundRobin = (
  queues: readonly (readonly GraphViewNode[])[],
  budget: number,
): GraphViewNode[] => {
  const chosen: GraphViewNode[] = [];
  let round = 0;
  while (chosen.length < budget && queues.some((queue) => queue.length > round)) {
    for (const queue of queues) {
      const member = queue[round];
      if (member !== undefined && chosen.length < budget) {
        chosen.push(member);
      }
    }
    round += 1;
  }
  return chosen;
};

/** Drawn members per group id — the "N drawn" half of every group's headline. */
export const countByGroup = (nodes: readonly GraphViewNode[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.groupId, (counts.get(node.groupId) ?? 0) + 1);
  }
  return counts;
};
