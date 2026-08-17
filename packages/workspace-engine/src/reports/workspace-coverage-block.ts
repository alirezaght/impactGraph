import { assessCoverageSufficiency, classifyUnmatchedRequirement } from '@impactgraph/domain';

import { isDisabledState } from '../repository-reasons.js';
import { buildRequirementSignals, indexedTypes } from '../requirement-signals.js';
import { resolveSuppliedIdentifiers } from '../supplied-identifiers.js';

import { conceptResolution, unmatchedRequirements } from './impact-summary-facts.js';

import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type { RepositoryIndexStateDto, WorkspaceCoverageDto } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, Specification } from '@impactgraph/domain';

/**
 * The repository-coverage half of the bounded summary: the deterministic verdict plus exactly
 * which repositories were indexed, which registered ones are missing or unavailable, and which
 * requirements and concepts depend on the gap. Reported by ImpactGraph so the agent never has to
 * guess that the graph is incomplete.
 */

const ROOT_STATE_NAME = '(workspace root)';

/**
 * Registered, enabled repositories absent from the current index — the roster FACT behind both
 * this verdict's `missingRepositoryCount` and the preflight `touchesUnindexedRepository` signal.
 * One computation, two consumers, so a classification rationale can never claim a missing
 * repository this block denies.
 */
export const unindexedRegisteredRepositories = (
  context: WorkspaceRepositoryContext | undefined,
): readonly RepositoryIndexStateDto[] =>
  (context?.repositories ?? []).filter(
    (state) => !state.indexed && state.name !== ROOT_STATE_NAME && !isDisabledState(state),
  );

export interface WorkspaceCoverageInput {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly context?: WorkspaceRepositoryContext | undefined;
  /** When supplied, sibling-surface evidence sharpens the new-surface reading of the signals. */
  readonly graph?: KnowledgeGraph | undefined;
}

/**
 * How many unmatched requirements read as NEW_SURFACE — computed BEFORE the sufficiency verdict,
 * from the same deterministic signals the preflight classifier uses, so new construction is never
 * counted as missing coverage.
 */
const newSurfaceCount = (
  input: WorkspaceCoverageInput,
  unmatched: ReturnType<typeof unmatchedRequirements>,
  missingRepositoryCount: number,
): number => {
  const signalContext = {
    analysis: input.analysis,
    missingRepositoryCount,
    indexedNodeTypes: input.graph === undefined ? new Set<string>() : indexedTypes(input.graph),
    // Without a graph nothing can be resolved, so no requirement may be called a wrong assumption.
    unresolvedSuppliedIdentifiers:
      input.graph === undefined
        ? []
        : resolveSuppliedIdentifiers(input.specification.rawText, input.graph).unresolvedInKnownScope,
  };
  return unmatched.filter(
    (requirement) =>
      classifyUnmatchedRequirement(
        requirement.label ?? requirement.id,
        buildRequirementSignals(requirement.statement, requirement.id, signalContext),
      ).classification === 'NEW_SURFACE',
  ).length;
};

/**
 * Unmatched requirements that name no component at all. A behaviour-level statement ("the review
 * output must lead with the verdict") names nothing the index could have matched, so its absence
 * says nothing about repository coverage (ADR-0022).
 */
const conceptlessUnmatchedCount = (unmatched: ReturnType<typeof unmatchedRequirements>): number =>
  unmatched.filter((requirement) => requirement.concepts.length === 0).length;

export const buildWorkspaceCoverage = (input: WorkspaceCoverageInput): WorkspaceCoverageDto => {
  const unmatched = unmatchedRequirements(input.specification, input.analysis);
  const concepts = conceptResolution(input.specification, input.analysis);
  const states = input.context?.repositories ?? [];
  const missing = states.filter((state) => !state.indexed && state.name !== ROOT_STATE_NAME);
  // A disabled member is a user decision, not a coverage gap the verdict should punish.
  const missingRepositoryCount = unindexedRegisteredRepositories(input.context).length;
  const verdict = assessCoverageSufficiency({
    requirementCount: input.specification.requirements.length,
    unmatchedRequirementCount: unmatched.length,
    totalConceptCount: concepts.totalConceptCount,
    unresolvedConceptCount: concepts.unresolvedConceptCount,
    missingRepositoryCount,
    newSurfaceRequirementCount: newSurfaceCount(input, unmatched, missingRepositoryCount),
    conceptlessUnmatchedCount: conceptlessUnmatchedCount(unmatched),
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
