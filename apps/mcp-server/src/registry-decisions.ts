import { acceptDeviation, selectArchitecturalOption } from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';

// Human-decision tools (Story 6.6/15.4 + 11.2). Both contracts require confirmedByUser: true
// — the human decided; the agent only records it (§21.1, §35). The parsed input guarantees
// the assertion before these handlers run.

const selectOption: ToolHandler<'select_architectural_option'> = async (rootDir, input) => {
  const selected = await selectArchitecturalOption({
    rootDir,
    analysisId: input.analysisId,
    optionId: input.optionId,
    modifiedDescription: input.modifiedDescription,
  });
  if (!selected.ok) {
    return selected;
  }
  return {
    ok: true,
    value: {
      specificationId: selected.value.specification.id,
      specificationVersion: selected.value.specification.version,
      decisionId: selected.value.decisionId,
      decisionRecorded: true,
      ...(selected.value.answeredQuestionId === undefined
        ? {}
        : { answeredQuestionId: selected.value.answeredQuestionId }),
    },
  };
};

const acceptReviewDeviation: ToolHandler<'accept_review_deviation'> = (rootDir, input) => {
  const accepted = acceptDeviation({
    rootDir,
    reviewId: input.reviewId,
    nodeId: input.nodeId,
    category: input.category,
    reason: input.reason,
    actor: 'agent',
  });
  if (!accepted.ok) {
    return Promise.resolve(accepted);
  }
  return Promise.resolve({
    ok: true,
    value: {
      reviewId: accepted.value.artifact.id,
      nodeId: accepted.value.decision.nodeId,
      category: accepted.value.decision.category,
      acceptedDeviationCount: accepted.value.artifact.acceptedDeviations.length,
    },
  });
};

export const DECISION_HANDLERS = {
  select_architectural_option: selectOption,
  accept_review_deviation: acceptReviewDeviation,
} as const;
