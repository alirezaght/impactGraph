import { compareImplementation } from '@impactgraph/application';

import { toFindingDto } from './reports/preflight-block.js';
import { reviewAgainstPlan } from './review-plan-contract.js';
import { createGitCliAdapter } from '@impactgraph/git';
import { readArchitectureConfig } from '@impactgraph/persistence';

import { loadApprovedAnalysis } from './analyses.js';
import { failWith } from './failure.js';
import { loadGraphAt, withIndexStore } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { appendLearningProposal, reviewCoChangeProposal } from './learning.js';
import { buildReviewDrift } from './reports/review-drift.js';
import { buildReviewOutput } from './reports/review-output.js';
import { collectWorkspaceRepositoryContext } from './repository-coverage.js';
import { persistReviewDocument } from './review-artifacts.js';
import { evaluateConfiguredRules, loadProjectKnowledge } from './rules.js';
import { GIT_FAILURES } from './snapshot.js';
import { loadSpecification } from './specifications.js';

import type { Failable } from './failure.js';
import type { ReviewBreakdownContext } from './reports/review-output.js';
import type { ReviewRepositoryScope } from './reports/review-scope.js';
import type { GitDiffResult, RuleViolation } from '@impactgraph/application';
import type {
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  ReviewTarget,
  Specification,
} from '@impactgraph/domain';

// The review workflow (PRD §23–§25): reindex current state, diff, compare against the frozen
// approved analysis, evaluate §27 rules. Fully deterministic and offline; the approved
// analysis is never modified.

export interface ReviewBundle {
  readonly review: ImplementationReview;
  readonly analysis: ImpactAnalysis;
  readonly violations: readonly RuleViolation[];
  /** Item 13: what the review document needs to split its findings by kind and state its scope. */
  readonly breakdownContext: ReviewBreakdownContext;
}

const readDiff = async (
  rootDir: string,
  target: ReviewTarget,
): Promise<Failable<GitDiffResult>> => {
  const git = createGitCliAdapter();
  const diff =
    target === 'working-tree'
      ? await git.readWorkingTreeDiff(rootDir)
      : await git.readCommitDiff(rootDir);
  if (!diff.ok) {
    return failWith(GIT_FAILURES[diff.error.code], diff.error.message);
  }
  return { ok: true, value: diff.value };
};

export const runReviewPipeline = async (
  rootDir: string,
  target: ReviewTarget,
): Promise<Failable<ReviewBundle>> => {
  const analysis = await loadApprovedAnalysis(rootDir);
  if (!analysis.ok) {
    return analysis;
  }
  const specification = await loadSpecification(
    rootDir,
    analysis.value.specificationId,
    analysis.value.specificationVersion,
  );
  if (!specification.ok) {
    return specification;
  }
  const diff = await readDiff(rootDir, target);
  if (!diff.ok) {
    return diff;
  }
  const indexed = await performIndexRun(rootDir);
  if (!indexed.ok) {
    return { ok: false, error: indexed.failure };
  }
  return compareAgainstApproved({
    rootDir,
    target,
    analysis: analysis.value,
    specification: specification.value,
    diff: diff.value,
    reviewSnapshotId: indexed.value.snapshot.id,
  });
};

interface CompareInputs {
  readonly rootDir: string;
  readonly target: ReviewTarget;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  readonly diff: GitDiffResult;
  readonly reviewSnapshotId: string;
}

const compareAgainstApproved = async (inputs: CompareInputs): Promise<Failable<ReviewBundle>> => {
  const { rootDir, analysis, specification, diff, reviewSnapshotId, target } = inputs;
  return withIndexStore(rootDir, async (store) => {
    const approvedGraph = await loadGraphAt(store, analysis.repositorySnapshotId, 'approved');
    if (!approvedGraph.ok) {
      return approvedGraph;
    }
    if (approvedGraph.value.nodes.size === 0 && analysis.requirementImpacts.length > 0) {
      return failWith(
        'indexingFailure',
        `approved snapshot ${analysis.repositorySnapshotId} is no longer in the local index — the cache was rebuilt since approval`,
      );
    }
    const currentGraph = await loadGraphAt(store, reviewSnapshotId, 'current');
    if (!currentGraph.ok) {
      return currentGraph;
    }
    const review = compareImplementation({
      reviewId: `review-${analysis.id}-${Date.now().toString(36)}`,
      analysis,
      specification,
      approvedGraph: approvedGraph.value,
      currentGraph: currentGraph.value,
      changes: diff.changes,
      reviewSnapshotId,
      target,
      createdAt: new Date().toISOString(),
    });
    if (!review.ok) {
      return failWith('internalError', 'review failed validation');
    }
    const violations = evaluateConfiguredRules(rootDir, currentGraph.value, [
      ...review.value.changedFiles,
    ]);
    if (!violations.ok) {
      return violations;
    }
    // Story 11.2: persist the review so accepted-deviation decisions have an artifact to
    // append to (§24.1). A later re-run is a NEW artifact — acceptance never carries over.
    const breakdownContext = await assembleBreakdownContext(inputs, {
      review: review.value,
      approvedGraph: approvedGraph.value,
      currentGraph: currentGraph.value,
    });
    // ADR-0017 — the approved plan as a contract, checked rather than archived.
    const planContract = reviewAgainstPlan({
      rootDir,
      analysis,
      review: review.value,
      approvedGraph: approvedGraph.value,
      currentGraph: currentGraph.value,
    });
    const persisted = persistReviewDocument(rootDir, {
      ...buildReviewOutput(review.value, analysis, violations.value, breakdownContext),
      planContract: {
        findings: planContract.findings.map(toFindingDto),
        unplannedPaths: [...planContract.unplannedPaths],
        unchangedExpectedPaths: [...planContract.unchangedExpectedPaths],
      },
    });
    if (!persisted.ok) {
      return persisted;
    }
    recordReviewLearning(rootDir, review.value.changedFiles);
    return {
      ok: true,
      value: { review: review.value, analysis, violations: violations.value, breakdownContext },
    };
  });
};

interface ComparedGraphs {
  readonly review: ImplementationReview;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
}

/**
 * Item 7/13: everything the review document adds around the findings — the breakdown inputs,
 * the measured repository scope, and the classified drift block. Best effort on the boundary
 * sources: an unreadable architecture config or roster disables the boundary categories, it
 * never fails the review.
 */
const assembleBreakdownContext = async (
  inputs: CompareInputs,
  compared: ComparedGraphs,
): Promise<ReviewBreakdownContext> => {
  const workspaceState = await measureWorkspaceState(inputs.rootDir);
  const architecture = readArchitectureConfig(inputs.rootDir);
  const drift = buildReviewDrift({
    review: compared.review,
    analysis: inputs.analysis,
    approvedGraph: compared.approvedGraph,
    currentGraph: compared.currentGraph,
    ...(architecture.ok && architecture.value !== undefined
      ? { architecture: architecture.value }
      : {}),
    rosterRepositories: workspaceState.rosterRepositories,
  });
  return {
    specification: inputs.specification,
    currentGraph: compared.currentGraph,
    addedPaths: inputs.diff.changes
      .filter((change) => change.changeType === 'added')
      .map((change) => change.path),
    ...(workspaceState.repositoryScope === undefined
      ? {}
      : { repositoryScope: workspaceState.repositoryScope }),
    drift,
  };
};

interface ReviewWorkspaceState {
  readonly repositoryScope?: ReviewRepositoryScope;
  /** Roster members for repository attribution — empty disables `cross-repository` drift. */
  readonly rosterRepositories: readonly {
    readonly name: string;
    readonly path?: string | undefined;
  }[];
}

/**
 * Item 7: measure what the review could NOT see — registered repositories missing from the index
 * and unregistered candidates — plus the roster prefixes drift attribution needs. Best effort:
 * when the roster is unreadable the scope is omitted and the breakdown states that as a
 * limitation instead of guessing, and drift simply loses its `cross-repository` category.
 */
const measureWorkspaceState = async (rootDir: string): Promise<ReviewWorkspaceState> => {
  const context = await collectWorkspaceRepositoryContext(rootDir);
  if (!context.ok) {
    return { rosterRepositories: [] };
  }
  return {
    repositoryScope: {
      // Members have a path relative to the root; the workspace root itself never does.
      unindexedRegistered: context.value.repositories
        .filter((state) => state.path !== undefined && !state.indexed)
        .map((state) => ({
          name: state.name,
          ...(state.reason === undefined ? {} : { reason: state.reason }),
        })),
      unregisteredCandidates: context.value.candidates.map((candidate) => candidate.path),
    },
    rosterRepositories: context.value.repositories.map((state) => ({
      name: state.name,
      ...(state.path === undefined ? {} : { path: state.path }),
    })),
  };
};

/** §Z9: review outcomes feed the learning-proposal queue — best effort, never blocking. */
const recordReviewLearning = (rootDir: string, changedFiles: readonly string[]): void => {
  const knowledge = loadProjectKnowledge(rootDir);
  if (!knowledge.ok) {
    return;
  }
  const proposal = reviewCoChangeProposal(changedFiles, knowledge.value.rules);
  if (proposal === undefined) {
    return;
  }
  appendLearningProposal(rootDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    kind: 'review-co-change',
    detail: proposal.reason,
    suggestedOperation: proposal,
  });
};
