import { ACCEPTABLE_DEVIATION_CATEGORIES } from '@impactgraph/contracts';

import { failWith } from './failure.js';
import { loadReviewArtifact, saveReviewArtifact } from './review-artifacts.js';

import type { Failable } from './failure.js';
import type { AcceptedDeviationDto, ReviewArtifactDto } from '@impactgraph/contracts';

// Story 11.2 — §24.1: a human marks a review discrepancy as an Accepted deviation with a
// recorded reason. The decision APPENDS to the review artifact; the finding is never
// rewritten, and a re-run review does not inherit the acceptance.

type DeviationCategory = AcceptedDeviationDto['category'];

export interface AcceptDeviationRequest {
  readonly rootDir: string;
  /** Defaults to the most recently created review. */
  readonly reviewId?: string | undefined;
  readonly nodeId: string;
  /** Disambiguates when one node carries several discrepancy findings. */
  readonly category?: DeviationCategory | undefined;
  readonly reason: string;
  /** Who records the acceptance — the human, or an agent acting on the human's behalf. */
  readonly actor: 'user' | 'agent';
}

export interface AcceptDeviationOutcome {
  readonly artifact: ReviewArtifactDto;
  readonly decision: AcceptedDeviationDto;
}

const isAcceptable = (category: string): category is DeviationCategory =>
  (ACCEPTABLE_DEVIATION_CATEGORIES as readonly string[]).includes(category);

const resolveCategory = (
  artifact: ReviewArtifactDto,
  request: AcceptDeviationRequest,
): Failable<DeviationCategory> => {
  const candidates = artifact.document.findings.filter(
    (finding) =>
      finding.nodeId === request.nodeId &&
      isAcceptable(finding.category) &&
      (request.category === undefined || finding.category === request.category),
  );
  const first = candidates[0];
  if (first === undefined || !isAcceptable(first.category)) {
    return failWith(
      'configurationError',
      `no discrepancy finding (missing/unexpected/divergent) for node '${request.nodeId}' in review '${artifact.id}'`,
    );
  }
  const categories = new Set(candidates.map((finding) => finding.category));
  if (categories.size > 1) {
    return failWith(
      'configurationError',
      `node '${request.nodeId}' has several discrepancy findings (${[...categories].join(', ')}) — pass the category to disambiguate`,
    );
  }
  if (
    artifact.acceptedDeviations.some(
      (d) => d.nodeId === request.nodeId && d.category === first.category,
    )
  ) {
    return failWith(
      'configurationError',
      `finding '${request.nodeId}' (${first.category}) is already accepted in review '${artifact.id}'`,
    );
  }
  return { ok: true, value: first.category };
};

/** Append an accepted-deviation decision to a stored review (append-only, §24.1). */
export const acceptDeviation = (
  request: AcceptDeviationRequest,
): Failable<AcceptDeviationOutcome> => {
  if (request.reason.trim().length === 0) {
    return failWith('configurationError', 'an accepted deviation requires a non-empty reason');
  }
  const loaded = loadReviewArtifact(request.rootDir, request.reviewId);
  if (!loaded.ok) {
    return loaded;
  }
  const category = resolveCategory(loaded.value, request);
  if (!category.ok) {
    return category;
  }
  const decision: AcceptedDeviationDto = {
    id: `dev-${Date.now().toString(36)}`,
    nodeId: request.nodeId,
    category: category.value,
    reason: request.reason,
    actor: request.actor,
    decidedAt: new Date().toISOString(),
  };
  const updated: ReviewArtifactDto = {
    ...loaded.value,
    acceptedDeviations: [...loaded.value.acceptedDeviations, decision],
  };
  const saved = saveReviewArtifact(request.rootDir, updated);
  if (!saved.ok) {
    return saved;
  }
  return { ok: true, value: { artifact: updated, decision } };
};
