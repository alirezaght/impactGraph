import { assessCoverageSufficiency } from '@impactgraph/domain';

import { conceptResolution, unmatchedRequirements } from './impact-summary-facts.js';

import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type { WorkspaceCoverageDto } from '@impactgraph/contracts';
import type { ImpactAnalysis, Specification } from '@impactgraph/domain';

/**
 * The repository-coverage half of the bounded summary: the deterministic verdict plus exactly
 * which repositories were indexed, which registered ones are missing or unavailable, and which
 * requirements and concepts depend on the gap. Reported by ImpactGraph so the agent never has to
 * guess that the graph is incomplete.
 */

const ROOT_STATE_NAME = '(workspace root)';

export interface WorkspaceCoverageInput {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly context?: WorkspaceRepositoryContext | undefined;
}

const DISABLED_REASON = 'disabled in configuration';

export const buildWorkspaceCoverage = (input: WorkspaceCoverageInput): WorkspaceCoverageDto => {
  const unmatched = unmatchedRequirements(input.specification, input.analysis);
  const concepts = conceptResolution(input.specification, input.analysis);
  const states = input.context?.repositories ?? [];
  const missing = states.filter((state) => !state.indexed && state.name !== ROOT_STATE_NAME);
  const verdict = assessCoverageSufficiency({
    requirementCount: input.specification.requirements.length,
    unmatchedRequirementCount: unmatched.length,
    totalConceptCount: concepts.totalConceptCount,
    unresolvedConceptCount: concepts.unresolvedConceptCount,
    // A disabled member is a user decision, not a coverage gap the verdict should punish.
    missingRepositoryCount: missing.filter((state) => state.reason !== DISABLED_REASON).length,
  });
  return {
    status: verdict.status,
    reasons: [...verdict.reasons],
    repositories: {
      indexed: states
        .filter((state) => state.indexed)
        .map((state) => ({
          name: state.name,
          ...(state.path === undefined ? {} : { path: state.path }),
          fileCount: state.fileCount,
        })),
      registeredButMissing: missing.map((state) => ({
        name: state.name,
        reason: state.reason ?? 'not in the current index',
      })),
      candidates: [...(input.context?.candidates ?? [])],
    },
    affectedRequirementIds: unmatched.map((requirement) => requirement.id),
    affectedConcepts: [...concepts.unresolvedConceptNames],
  };
};
