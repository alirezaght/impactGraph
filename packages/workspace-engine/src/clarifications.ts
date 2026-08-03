import {
  answerOpenQuestion as answerInDomain,
  clarificationQuestionKey,
  computeReadiness,
  createClarificationRecord,
} from '@impactgraph/domain';
import {
  artifactsPath,
  createClarificationArtifactStore,
  createSpecificationArtifactStore,
} from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type {
  ClarificationAuthor,
  ClarificationRecord,
  OpenQuestion,
  ReadinessReport,
  Specification,
} from '@impactgraph/domain';

// Story 15.5 — answering an open question is one append-only transaction of meaning:
// specification version N+1 (question answered) + a persistent clarification ADR (§C9)
// that stops future analyses from re-asking. Nothing here rewrites history.

export interface AnswerQuestionRequest {
  readonly rootDir: string;
  readonly specificationId: string;
  readonly questionId: string;
  readonly answer: string;
  readonly author?: ClarificationAuthor | undefined;
  readonly reason?: string | undefined;
}

export interface AnswerQuestionOutcome {
  readonly specification: Specification;
  readonly readiness: ReadinessReport;
  readonly clarificationId: string;
}

const persistAdr = async (
  request: AnswerQuestionRequest,
  question: OpenQuestion,
  specificationVersion: number,
): Promise<Failable<string>> => {
  const author = request.author ?? 'user';
  const record = createClarificationRecord({
    id: `clar-${clarificationQuestionKey(question.question)}-${Date.now().toString(36)}`,
    questionKey: clarificationQuestionKey(question.question),
    question: question.question,
    decision: request.answer,
    reason: request.reason ?? question.reason,
    specificationId: request.specificationId,
    specificationVersion,
    relatedRequirementIds: question.affectedRequirementIds,
    relatedNodeIds: [],
    relatedContexts: [],
    decidedAt: new Date().toISOString(),
    author,
    confidence: 1,
    manuallyConfirmed: author === 'user',
  });
  if (!record.ok) {
    return failWith('internalError', 'clarification record failed validation');
  }
  const persisted = await createClarificationArtifactStore(artifactsPath(request.rootDir)).save(
    record.value,
  );
  if (!persisted.ok) {
    return failWith('configurationError', persisted.error.message);
  }
  return { ok: true, value: record.value.id };
};

export const answerQuestion = async (
  request: AnswerQuestionRequest,
): Promise<Failable<AnswerQuestionOutcome>> => {
  const specStore = createSpecificationArtifactStore(artifactsPath(request.rootDir));
  const latest = await specStore.getLatest(request.specificationId);
  if (!latest.ok) {
    return failWith('configurationError', latest.error.message);
  }
  if (latest.value === undefined) {
    return failWith('configurationError', `specification not found: ${request.specificationId}`);
  }
  const question = latest.value.openQuestions.find((entry) => entry.id === request.questionId);
  const answered = answerInDomain(
    latest.value,
    request.questionId,
    request.answer,
    new Date().toISOString(),
  );
  if (!answered.ok || question === undefined) {
    return failWith(
      'configurationError',
      answered.ok ? 'question not found' : (answered.error.issues[0]?.message ?? 'invalid answer'),
    );
  }
  const saved = await specStore.saveVersion(answered.value);
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  const clarificationId = await persistAdr(request, question, answered.value.version);
  if (!clarificationId.ok) {
    return clarificationId;
  }
  return {
    ok: true,
    value: {
      specification: answered.value,
      readiness: computeReadiness(answered.value),
      clarificationId: clarificationId.value,
    },
  };
};

/** All recorded clarification ADRs for the workspace (§C9 lookup). */
export const listClarifications = async (
  rootDir: string,
): Promise<Failable<readonly ClarificationRecord[]>> => {
  const listed = await createClarificationArtifactStore(artifactsPath(rootDir)).listAll();
  if (!listed.ok) {
    return failWith('configurationError', listed.error.message);
  }
  return { ok: true, value: listed.value };
};
