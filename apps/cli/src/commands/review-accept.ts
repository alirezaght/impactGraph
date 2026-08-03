import {
  ACCEPTABLE_DEVIATION_CATEGORIES,
  cliAcceptDeviationOutputSchema,
} from '@impactgraph/contracts';
import {
  acceptDeviation,
  applyAcceptedDeviations,
  buildReviewMarkdown,
} from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';
import type { AcceptedDeviationDto } from '@impactgraph/contracts';

// Story 11.2 — `impactgraph review accept <nodeId> <reason> [category]`: the USER accepts a
// discrepancy of the LATEST persisted review as a deviation (§24.1). Append-only; the finding
// is never rewritten, and re-running the review does not inherit the acceptance.

type Category = AcceptedDeviationDto['category'];

const parseCategory = (raw: string | undefined): Category | undefined | 'invalid' => {
  if (raw === undefined) {
    return undefined;
  }
  return (ACCEPTABLE_DEVIATION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as Category)
    : 'invalid';
};

export const runReviewAccept = (context: CommandContext): CommandResult => {
  const [, nodeId, reason, categoryRaw] = context.args;
  const category = parseCategory(categoryRaw);
  if (nodeId === undefined || reason === undefined || category === 'invalid') {
    return failed({
      category: 'configurationError',
      message:
        'usage: impactgraph review accept <nodeId> "<reason>" [missing|unexpected|divergent]',
    });
  }
  const accepted = acceptDeviation({
    rootDir: context.rootDir,
    nodeId,
    reason,
    category,
    actor: 'user',
  });
  if (!accepted.ok) {
    return failed(accepted.error);
  }
  const { artifact, decision } = accepted.value;
  if (context.format === 'json') {
    writeJson(context, cliAcceptDeviationOutputSchema, {
      schemaVersion: 1,
      command: 'review-accept',
      reviewId: artifact.id,
      nodeId: decision.nodeId,
      category: decision.category,
      reason: decision.reason,
      acceptedDeviationCount: artifact.acceptedDeviations.length,
    });
  } else if (context.format === 'markdown') {
    writeLines(
      context,
      buildReviewMarkdown(applyAcceptedDeviations(artifact.document, artifact.acceptedDeviations)),
    );
  } else {
    writeLines(context, [
      `accepted deviation on '${decision.nodeId}' (${decision.category}) in review ${artifact.id}`,
      `reason: ${decision.reason}`,
    ]);
  }
  return succeeded();
};
