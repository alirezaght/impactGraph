import { computeReadiness } from '@impactgraph/domain';
import {
  answerQuestion,
  confirmRequirement,
  createWorkspaceAiServices,
  dismissQuestion,
  editRequirement,
  explainNode,
  loadSpecification,
  rejectRequirement,
  submitSpecification,
} from '@impactgraph/workspace-engine';

import { buildSpecificationState } from '../webview/spec-model.js';

import type { EngineJobSpec } from './protocol.js';
import type { SpecificationPanelStateDto } from '@impactgraph/contracts';
import type { Specification } from '@impactgraph/domain';
import type { Failable } from '@impactgraph/workspace-engine';

// Story 9.1/9.3 — the specification-panel and evidence-panel halves of the engine worker.
// Every call goes to an EXISTING workspace-engine export; this file only chooses which one and
// projects the result onto the contract DTO. No analysis logic lives here (main skill §9).

type SpecMutateJob = Extract<EngineJobSpec, { op: 'spec-mutate' }>;
type SpecRef = { readonly rootDir: string; readonly specificationId: string };

const stateOf = (
  specification: Specification,
  extractionMode?: 'provider' | 'deterministic-fallback' | 'unchanged',
): SpecificationPanelStateDto =>
  buildSpecificationState({
    specification,
    readiness: computeReadiness(specification),
    ...(extractionMode === undefined ? {} : { extractionMode }),
  });

const submitJob = async (
  request: Extract<EngineJobSpec, { op: 'spec-submit' }>,
): Promise<Failable<SpecificationPanelStateDto>> => {
  const ai = createWorkspaceAiServices(request.rootDir, { apiKey: request.apiKey });
  if (!ai.ok) {
    return ai;
  }
  const submitted = await submitSpecification({
    rootDir: request.rootDir,
    specName: request.specName,
    rawText: request.rawText,
    extractor: ai.value.extractor,
  });
  if (!submitted.ok) {
    return submitted;
  }
  return {
    ok: true,
    value: stateOf(submitted.value.specification, submitted.value.extractionMode),
  };
};

/** §C9: answering also records a clarification ADR — the engine owns that, not the shell. */
const answerJob = async (
  base: SpecRef,
  questionId: string,
  answer: string,
): Promise<Failable<Specification>> => {
  const answered = await answerQuestion({ ...base, questionId, answer, author: 'user' });
  return answered.ok ? { ok: true, value: answered.value.specification } : answered;
};

const mutation = (request: SpecMutateJob, base: SpecRef): Promise<Failable<Specification>> => {
  const requirementId = request.requirementId ?? '';
  const questionId = request.questionId ?? '';
  switch (request.action) {
    case 'confirm':
      return confirmRequirement({ ...base, requirementId });
    case 'reject':
      return rejectRequirement({ ...base, requirementId });
    case 'edit':
      return editRequirement({ ...base, requirementId, statement: request.statement ?? '' });
    case 'dismiss':
      return dismissQuestion({ ...base, questionId });
    case 'answer':
      return answerJob(base, questionId, request.answer ?? '');
  }
};

const mutateJob = async (request: SpecMutateJob): Promise<Failable<SpecificationPanelStateDto>> => {
  const mutated = await mutation(request, {
    rootDir: request.rootDir,
    specificationId: request.specificationId,
  });
  return mutated.ok ? { ok: true, value: stateOf(mutated.value) } : mutated;
};

/** Handles every webview-driven job; returns undefined for ops this module does not own. */
export const runWebviewJob = async (
  request: EngineJobSpec,
): Promise<Failable<unknown> | undefined> => {
  if (request.op === 'spec-submit') {
    return submitJob(request);
  }
  if (request.op === 'spec-mutate') {
    return mutateJob(request);
  }
  if (request.op === 'spec-load') {
    const loaded = await loadSpecification(
      request.rootDir,
      request.specificationId,
      request.version,
    );
    return loaded.ok ? { ok: true, value: stateOf(loaded.value) } : loaded;
  }
  if (request.op === 'explain-node') {
    return explainNode(request.rootDir, request.nodeId);
  }
  return undefined;
};
