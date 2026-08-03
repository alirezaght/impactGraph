import type { LearningProposalDto } from '@impactgraph/contracts';
import type { DriftItem, DriftReport } from '@impactgraph/workspace-engine';

// The Issues view (§18.1, Stories 7.2/8.3/14.5) — pure mapping, unit-tested without Electron.
// Everything here is an INPUT to human judgment: stale mappings kept for review (§Z5), drift
// suggestions awaiting the ownership mode, queued learning proposals, index warnings.

export interface IssueTreeNode {
  readonly kind: 'section' | 'drift' | 'suggestion' | 'proposal' | 'warning' | 'empty';
  readonly label: string;
  readonly description?: string | undefined;
  readonly tooltip?: string | undefined;
  readonly children: readonly IssueTreeNode[];
}

export interface IssuesInput {
  readonly drift: DriftReport | undefined;
  readonly proposals: readonly LearningProposalDto[];
  readonly indexWarnings: readonly string[];
}

const driftNode = (item: DriftItem, kind: 'drift' | 'suggestion'): IssueTreeNode => ({
  kind,
  label: `[${item.kind}] ${item.subject}`,
  description: item.detail,
  tooltip: item.detail,
  children: [],
});

const section = (
  label: string,
  children: readonly IssueTreeNode[],
  emptyText: string,
): IssueTreeNode => ({
  kind: 'section',
  label,
  description: String(children.length),
  children: children.length > 0 ? children : [{ kind: 'empty', label: emptyText, children: [] }],
});

export const buildIssueItems = (input: IssuesInput): IssueTreeNode[] => [
  section(
    'Configuration drift — needs review (§Z10)',
    (input.drift?.needsReview ?? []).map((item) => driftNode(item, 'drift')),
    'configuration matches the current graph',
  ),
  section(
    'Drift suggestions (apply via configuration tools)',
    (input.drift?.suggestions ?? []).map((item) => driftNode(item, 'suggestion')),
    'no suggested changes',
  ),
  section(
    'Learning proposals (§Z9 — queued, never auto-applied)',
    input.proposals.map((proposal) => ({
      kind: 'proposal' as const,
      label: proposal.kind,
      description: proposal.detail,
      tooltip: proposal.detail,
      children: [],
    })),
    'no proposals recorded',
  ),
  section(
    'Last index warnings',
    input.indexWarnings.map((warning) => ({
      kind: 'warning' as const,
      label: warning,
      children: [],
    })),
    'no warnings in the last run',
  ),
];
