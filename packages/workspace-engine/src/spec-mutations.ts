import {
  confirmRequirement as confirmInDomain,
  dismissOpenQuestion as dismissInDomain,
  editRequirementStatement as editInDomain,
  rejectRequirement as rejectInDomain,
} from '@impactgraph/domain';
import { artifactsPath, createSpecificationArtifactStore } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { Result, Specification, ValidationError } from '@impactgraph/domain';

// Story 5.4 — engine wiring for specification mutations: load the latest stored version,
// apply the pure domain mutation, save version N+1 (append-only, §40.2). Unlike answering a
// question (clarifications.ts), these record no clarification ADR. Stored analyses are never
// touched — staleness is derived at read time in analyses.ts, never written.

type DomainMutation = (
  specification: Specification,
  updatedAt: string,
) => Result<Specification, ValidationError>;

const applyMutation = async (
  rootDir: string,
  specificationId: string,
  mutate: DomainMutation,
): Promise<Failable<Specification>> => {
  const store = createSpecificationArtifactStore(artifactsPath(rootDir));
  const latest = await store.getLatest(specificationId);
  if (!latest.ok) {
    return failWith('configurationError', latest.error.message);
  }
  if (latest.value === undefined) {
    return failWith('configurationError', `specification not found: ${specificationId}`);
  }
  const mutated = mutate(latest.value, new Date().toISOString());
  if (!mutated.ok) {
    return failWith(
      'configurationError',
      mutated.error.issues[0]?.message ?? 'specification mutation failed validation',
    );
  }
  const saved = await store.saveVersion(mutated.value);
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  return { ok: true, value: mutated.value };
};

export interface RequirementMutationRequest {
  readonly rootDir: string;
  readonly specificationId: string;
  readonly requirementId: string;
}

/** Confirm an extracted requirement: specification version N+1 with status `confirmed`. */
export const confirmRequirement = (
  request: RequirementMutationRequest,
): Promise<Failable<Specification>> =>
  applyMutation(request.rootDir, request.specificationId, (specification, updatedAt) =>
    confirmInDomain(specification, request.requirementId, updatedAt),
  );

/** Reject an extracted requirement: version N+1 with status `rejected`, record preserved. */
export const rejectRequirement = (
  request: RequirementMutationRequest,
): Promise<Failable<Specification>> =>
  applyMutation(request.rootDir, request.specificationId, (specification, updatedAt) =>
    rejectInDomain(specification, request.requirementId, updatedAt),
  );

export interface EditRequirementRequest extends RequirementMutationRequest {
  readonly statement: string;
}

/** Edit a requirement's statement; the original requirement id is kept (Story 5.4). */
export const editRequirement = (
  request: EditRequirementRequest,
): Promise<Failable<Specification>> =>
  applyMutation(request.rootDir, request.specificationId, (specification, updatedAt) =>
    editInDomain(specification, request.requirementId, request.statement, updatedAt),
  );

export interface DismissQuestionRequest {
  readonly rootDir: string;
  readonly specificationId: string;
  readonly questionId: string;
}

/** Dismiss an open question: version N+1 with status `dismissed`, question preserved. */
export const dismissQuestion = (
  request: DismissQuestionRequest,
): Promise<Failable<Specification>> =>
  applyMutation(request.rootDir, request.specificationId, (specification, updatedAt) =>
    dismissInDomain(specification, request.questionId, updatedAt),
  );
