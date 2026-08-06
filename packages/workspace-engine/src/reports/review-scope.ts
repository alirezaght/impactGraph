import type { CliReviewBreakdown } from '@impactgraph/contracts';
import type { ImplementationReview } from '@impactgraph/domain';

/**
 * Item 7: the review must explain its own confidence and scope. Everything here is DERIVED from
 * measured facts — index state, finding categories, truncation counts — never asserted as a
 * constant and never asked of a model.
 */

/** What the review run knew about the workspace's repository roster, when it knew it. */
export interface ReviewRepositoryScope {
  /** Registered repositories that contributed no files to the review index. */
  readonly unindexedRegistered: readonly { readonly name: string; readonly reason?: string }[];
  /** Discovered-but-unregistered repository paths — never part of the review. */
  readonly unregisteredCandidates: readonly string[];
}

export interface ReviewScopeInput {
  readonly review: ImplementationReview;
  /** Undefined when the caller did not distinguish added files from modified ones. */
  readonly addedPaths?: readonly string[];
  /** Undefined when the caller could not read the roster — itself a stated limitation. */
  readonly repositoryScope?: ReviewRepositoryScope;
}

const omittedEdgeCount = (review: ImplementationReview): number =>
  (review.edgeChanges.omittedAdded ?? 0) + (review.edgeChanges.omittedRemoved ?? 0);

const repositoryLimitations = (scope: ReviewRepositoryScope | undefined): string[] => {
  if (scope === undefined) {
    return [
      'The registered-repository index state was not available; unindexed repositories cannot be ruled out.',
    ];
  }
  const lines = scope.unindexedRegistered.map(
    (repo) =>
      `Registered repository '${repo.name}' was not indexed; changes there were not reviewed` +
      `${repo.reason === undefined ? '' : ` (${repo.reason})`}.`,
  );
  if (scope.unregisteredCandidates.length > 0) {
    lines.push(
      `Discovered repositories are not registered and were not reviewed: ${scope.unregisteredCandidates.join(', ')}.`,
    );
  }
  return lines;
};

/** Measured limitations for `scope.limitations` — each names what was NOT reviewed and why. */
export const deriveScopeLimitations = (input: ReviewScopeInput): string[] => {
  const omitted = omittedEdgeCount(input.review);
  return [
    'Only this workspace was compared; repositories not registered in the workspace were not analyzed.',
    ...repositoryLimitations(input.repositoryScope),
    ...(omitted > 0
      ? [
          `Architectural edge-change lists were truncated: ${String(omitted)} edge ids were omitted.`,
        ]
      : []),
    ...(input.addedPaths === undefined
      ? ['Added files were not distinguished from modified files by the caller.']
      : []),
  ];
};

interface ConfidenceFactor {
  readonly severity: 'severe' | 'moderate';
  readonly reason: string;
}

const unverifiableFactor = (review: ImplementationReview): ConfidenceFactor | undefined => {
  const total = review.findings.length;
  const unverifiable = review.findings.filter(
    (finding) => finding.category === 'unverifiable',
  ).length;
  if (total === 0 || unverifiable === 0) {
    return undefined;
  }
  return {
    severity: unverifiable * 2 >= total ? 'severe' : 'moderate',
    reason: `${String(unverifiable)} of ${String(total)} findings were unverifiable from the diff.`,
  };
};

const repositoryFactors = (scope: ReviewRepositoryScope | undefined): ConfidenceFactor[] => {
  if (scope === undefined) {
    return [
      {
        severity: 'moderate',
        reason: 'The registered-repository index state was not available to this review.',
      },
    ];
  }
  const factors: ConfidenceFactor[] = scope.unindexedRegistered.map((repo) => ({
    severity: 'severe',
    reason: `Registered repository '${repo.name}' was not indexed, so its changes were invisible to this review.`,
  }));
  if (scope.unregisteredCandidates.length > 0) {
    factors.push({
      severity: 'moderate',
      reason: `${String(scope.unregisteredCandidates.length)} discovered repositories are unregistered and were not reviewed.`,
    });
  }
  return factors;
};

/**
 * Deterministic confidence in the review's own verdicts (item 7).
 *
 * `low` — a severe factor: a registered repository was missing from the index, or at least half
 * of the findings were unverifiable. `limited` — only moderate factors: some unverifiable
 * findings, truncated edge-change lists, undistinguished added files, unregistered candidate
 * repositories, or an unreadable roster. `high` — no degrading factor, with the reason stated.
 */
export const deriveReviewConfidence = (
  input: ReviewScopeInput,
): NonNullable<CliReviewBreakdown['confidence']> => {
  const factors: ConfidenceFactor[] = [...repositoryFactors(input.repositoryScope)];
  const unverifiable = unverifiableFactor(input.review);
  if (unverifiable !== undefined) {
    factors.push(unverifiable);
  }
  const omitted = omittedEdgeCount(input.review);
  if (omitted > 0) {
    factors.push({
      severity: 'moderate',
      reason: `Edge-change reporting was truncated (${String(omitted)} edge ids omitted).`,
    });
  }
  if (input.addedPaths === undefined) {
    factors.push({
      severity: 'moderate',
      reason: 'Added files were not distinguished from modified files.',
    });
  }
  if (factors.length === 0) {
    return {
      level: 'high',
      reasons: [
        'Every finding was verifiable from the diff and every registered repository was present in the review index.',
      ],
    };
  }
  return {
    level: factors.some((factor) => factor.severity === 'severe') ? 'low' : 'limited',
    reasons: factors.map((factor) => factor.reason),
  };
};
