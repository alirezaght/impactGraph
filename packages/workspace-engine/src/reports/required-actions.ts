import { isNotIndexedState, isUnavailableState } from '../repository-reasons.js';

import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type {
  EvidenceQualityDto,
  PlanningSignalDto,
  RequiredActionDto,
  WorkspaceCoverageDto,
} from '@impactgraph/contracts';
import type { IndexFreshness } from '@impactgraph/domain';

/**
 * Machine-readable next steps, derived from evidence ImpactGraph already holds: index freshness,
 * the repository roster, discovery, and the coverage verdict. Deterministic and ordered by how a
 * caller should work through them; the agent follows, it never diagnoses.
 */

export interface RequiredActionsInput {
  readonly coverage: WorkspaceCoverageDto;
  readonly freshness: IndexFreshness;
  readonly context?: WorkspaceRepositoryContext | undefined;
  /** The evidence-quality verdict over the shown impacts; absent when no analysis was run. */
  readonly evidenceQuality?: EvidenceQualityDto | undefined;
  /** ADR-0025: the decisions/context/leads split over the WHOLE analysis, not the shown page. */
  readonly planningSignal?: PlanningSignalDto | undefined;
}

const names = (entries: readonly { readonly name: string }[]): string[] =>
  entries.map((entry) => entry.name);

const refreshAction = (freshness: IndexFreshness): RequiredActionDto[] =>
  freshness.stale
    ? [
        {
          action: 'refresh-stale-index',
          reason: freshness.reasons.join(' ') || 'the index no longer matches the working tree',
          instruction:
            freshness.recommendedAction ?? 'Run index_workspace, then re-run analyze_impact.',
        },
      ]
    : [];

const repositoryActions = (context: WorkspaceRepositoryContext | undefined): RequiredActionDto[] => {
  const states = context?.repositories ?? [];
  const unindexed = states.filter(isNotIndexedState);
  const absent = states.filter(isUnavailableState);
  return [
    ...(unindexed.length === 0
      ? []
      : [
          {
            action: 'index-registered-repositories' as const,
            reason: `registered repositories are missing from the current index: ${names(unindexed).join(', ')}`,
            instruction:
              'Run index_workspace — it indexes every registered, present repository automatically — then re-run analyze_impact.',
            repositories: names(unindexed),
          },
        ]),
    ...(absent.length === 0
      ? []
      : [
          {
            action: 'register-missing-repositories' as const,
            reason: `registered repositories are unavailable: ${absent
              .map((state) => `${state.name} (${state.reason ?? 'not present'})`)
              .join(', ')}`,
            instruction:
              'Ask the user where these repositories live. Registered paths must stay inside the workspace root — fix the `repositories:` entries in .impactgraph/config.yml (or ask the user to open a common parent as the workspace), then run index_workspace and re-run analyze_impact.',
            repositories: names(absent),
          },
        ]),
  ];
};

const candidateAction = (input: RequiredActionsInput): RequiredActionDto[] => {
  const candidates = input.context?.candidates ?? [];
  if (candidates.length === 0 || input.coverage.status !== 'insufficient-coverage') {
    return [];
  }
  return [
    {
      action: 'confirm-candidate-repositories',
      reason: `unregistered repositories were discovered in the workspace: ${names(candidates).join(', ')}`,
      instruction:
        'Ask the user which of these repositories belong to this feature, register the confirmed ones under `repositories:` in .impactgraph/config.yml, then run index_workspace and re-run analyze_impact. Never index them without confirmation.',
      repositories: names(candidates),
    },
  ];
};

export const buildRequiredActions = (input: RequiredActionsInput): RequiredActionDto[] => {
  const actions: RequiredActionDto[] = [
    ...refreshAction(input.freshness),
    ...repositoryActions(input.context),
    ...candidateAction(input),
  ];
  const expandsCoverage = actions.some((action) => action.action !== 'refresh-stale-index');
  if (input.coverage.status === 'insufficient-coverage' && !expandsCoverage) {
    actions.push({
      action: 'report-limited-scope',
      reason: input.coverage.reasons.join(' ') || 'repository coverage is insufficient',
      instruction:
        'Stop and report limited scope: state which repositories were indexed and present the unmatched requirements and unresolved concepts as gaps — do not present the partial impacts as a complete answer. If the user can point at the missing repositories, register and index them instead.',
    });
  }
  actions.push(...limitedEvidenceAction(input));
  return actions;
};

/**
 * The weak-evidence warning, from either direction.
 *
 * The shown-set verdict is the original signal: what a reader is looking at rests on resemblances.
 * ADR-0025 added a second way to reach the same place — the role gate keeps resemblances OUT of the
 * primary view, so an analysis made entirely of name matches now presents as an empty plan rather
 * than a weak one. An empty plan over a non-empty analysis is the strongest form of this warning,
 * not the absence of it.
 */
const limitedEvidenceAction = (input: RequiredActionsInput): RequiredActionDto[] => {
  const signal = input.planningSignal;
  const emptyPlan = signal !== undefined && signal.totalCount > 0 && signal.planningImpactCount === 0;
  if (input.evidenceQuality?.status !== 'weak' && !emptyPlan) {
    return [];
  }
  const reason = emptyPlan
    ? `no finding qualified as a planning decision — ${String(signal.investigationLeadCount)} rest on name or meaning matches and ${String(signal.dependencyContextCount)} are reachable components with no evidence of impact`
    : (input.evidenceQuality?.reasons.join(' ') ?? '') || 'the shown impacts rest on weak evidence';
  return [
    {
      action: 'report-limited-evidence',
      reason,
      instruction:
        'Treat this prediction as exploratory: nothing here rests on structural evidence of change. Confirm the component names with find_components or with the user before implementing against them, and present the result as a starting point, not a change list.',
    },
  ];
};
