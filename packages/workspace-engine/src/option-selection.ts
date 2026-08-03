import { createNextSpecificationVersion } from '@impactgraph/domain';
import { artifactsPath, createSpecificationArtifactStore } from '@impactgraph/persistence';

import { loadAnalysis } from './analyses.js';
import { failWith } from './failure.js';
import { loadSpecification } from './specifications.js';

import type { Failable } from './failure.js';
import type {
  ArchitecturalDecision,
  ArchitecturalOption,
  Specification,
} from '@impactgraph/domain';

// Story 6.6/15.4 — selecting a §C8/§26 architectural option. The option stays AI-labeled on
// the analysis; the SELECTION is a human decision, recorded as an ArchitecturalDecision on
// specification version N+1 (append-only, §40.2). The analysis is never mutated — approval
// immutability holds even for this workflow (§40.3).

export interface SelectOptionRequest {
  readonly rootDir: string;
  readonly analysisId: string;
  readonly optionId: string;
  /** §C8: the user may modify the option before selecting; the decision records that form. */
  readonly modifiedDescription?: string | undefined;
}

export interface SelectOptionOutcome {
  readonly specification: Specification;
  readonly option: ArchitecturalOption;
  readonly decisionId: string;
  /** §C8: the question this selection resolved, when the option carries the link. */
  readonly answeredQuestionId?: string | undefined;
}

/** §C8: selecting an option ANSWERS its question — the answer is the chosen option's text. */
const answerLinkedQuestion = (
  specification: Specification,
  option: ArchitecturalOption,
  answer: string,
): { openQuestions: Specification['openQuestions']; answeredQuestionId: string | undefined } => {
  const linked = option.linkedQuestionId;
  if (linked === undefined) {
    return { openQuestions: specification.openQuestions, answeredQuestionId: undefined };
  }
  const target = specification.openQuestions.find(
    (question) => question.id === linked && question.status === 'open',
  );
  if (target === undefined) {
    return { openQuestions: specification.openQuestions, answeredQuestionId: undefined };
  }
  return {
    openQuestions: specification.openQuestions.map((question) =>
      question.id === linked ? { ...question, status: 'answered' as const, answer } : question,
    ),
    answeredQuestionId: linked,
  };
};

const decisionFor = (
  request: SelectOptionRequest,
  option: ArchitecturalOption,
  decidedAt: string,
): ArchitecturalDecision => ({
  id: `adr-${option.id.replace(/[^a-zA-Z0-9._-]/g, '-')}-${Date.now().toString(36)}`,
  decision: `${option.title} — ${request.modifiedDescription ?? option.description}`,
  reason: `user selected AI-assisted architectural option '${option.id}' from analysis '${request.analysisId}' as the approved direction (§26)${request.modifiedDescription === undefined ? '' : '; description modified by the user'}`,
  optionId: option.id,
  decidedAt,
});

/**
 * Record an option selection: load the analysis, resolve the option, append an
 * ArchitecturalDecision to the specification (version N+1) and — when the option carries its
 * §C8 `linkedQuestionId` — mark that open question answered with the selected option's text.
 * Options generated before the link existed still work: they record the decision only.
 */
export const selectArchitecturalOption = async (
  request: SelectOptionRequest,
): Promise<Failable<SelectOptionOutcome>> => {
  const analysis = await loadAnalysis(request.rootDir, request.analysisId);
  if (!analysis.ok) {
    return analysis;
  }
  const option = analysis.value.architecturalOptions.find(
    (candidate) => candidate.id === request.optionId,
  );
  if (option === undefined) {
    return failWith(
      'configurationError',
      `option '${request.optionId}' not found in analysis '${request.analysisId}'`,
    );
  }
  const specification = await loadSpecification(request.rootDir, analysis.value.specificationId);
  if (!specification.ok) {
    return specification;
  }
  const decidedAt = new Date().toISOString();
  const decision = decisionFor(request, option, decidedAt);
  const answered = answerLinkedQuestion(specification.value, option, decision.decision);
  const nextVersion = createNextSpecificationVersion(
    specification.value,
    {
      decisions: [...specification.value.decisions, decision],
      openQuestions: answered.openQuestions,
    },
    decidedAt,
  );
  if (!nextVersion.ok) {
    return failWith('internalError', 'specification with recorded decision failed validation');
  }
  const saved = await createSpecificationArtifactStore(artifactsPath(request.rootDir)).saveVersion(
    nextVersion.value,
  );
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  return {
    ok: true,
    value: {
      specification: nextVersion.value,
      option,
      decisionId: decision.id,
      answeredQuestionId: answered.answeredQuestionId,
    },
  };
};
