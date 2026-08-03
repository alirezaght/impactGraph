import { disclosureSummary } from '../graph/disclosure.js';

import type { DisclosurePlan } from '../graph/disclosure.js';
import type { JSX } from 'react';

// PRD §43.1 — the visible half of progressive disclosure. Whenever the node budget bites, the
// user is told the exact counts and given the expand affordance; nothing is truncated silently.

interface Props {
  readonly plan: DisclosurePlan;
  readonly totalNodeCount: number;
  readonly expandedGroupIds: readonly string[];
  readonly onToggleGroup: (groupId: string) => void;
}

export const DisclosureNotice = ({
  plan,
  totalNodeCount,
  expandedGroupIds,
  onToggleGroup,
}: Props): JSX.Element => (
  <div className="disclosure">
    <p className="graph-summary" role="status">
      {disclosureSummary(plan, totalNodeCount)}
    </p>
    {plan.budgetExceeded ? (
      <p className="graph-degraded" role="status">
        This analysis exceeds the visible-node budget, so groups start collapsed. Expand a group
        below, or narrow the filters.
      </p>
    ) : null}
    {plan.collapsedGroups.length === 0 ? null : (
      <ul className="collapsed-groups" aria-label="Groups with hidden nodes">
        {plan.collapsedGroups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              aria-expanded={expandedGroupIds.includes(group.id)}
              onClick={() => {
                onToggleGroup(group.id);
              }}
            >
              {expandedGroupIds.includes(group.id) ? 'Collapse' : 'Expand'} {group.label} —{' '}
              {group.hiddenCount} hidden
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
