import { compareImplementation } from '@impactgraph/application';
import { createGitCliAdapter } from '@impactgraph/git';
import { readArchitectureConfig } from '@impactgraph/persistence';

import { loadReviewBaseline } from './analyses.js';
import { failWith } from './failure.js';
import { loadGraphAt, withIndexStore } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { appendLearningProposal, reviewCoChangeProposal } from './learning.js';
import { toFindingDto } from './reports/preflight-block.js';
import { buildReviewDrift } from './reports/review-drift.js';
import { buildReviewOutput } from './reports/review-output.js';
import { collectWorkspaceRepositoryContext } from './repository-coverage.js';
import { persistReviewDocument } from './review-artifacts.js';
import { reviewAgainstPlan } from './review-plan-contract.js';
import { evaluateConfiguredRules, loadProjectKnowledge } from './rules.js';
import { GIT_FAILURES } from './snapshot.js';
import { loadSpecification } from './specifications.js';

import type { BaselineAuthority, ReviewBaselineOptions } from './analyses.js';
import type { Failable } from './failure.js';
import type { ReviewBreakdownContext } from './reports/review-output.js';
import type { ReviewRepositoryScope } from './reports/review-scope.js';
import type { PlanContractInput } from './review-plan-contract.js';
import type { GitDiffResult, RuleViolation } from '@impactgraph/application';
import type { CliReviewOutput } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  ReviewTarget,
  Specification,
} from '@impactgraph/domain';

// The review workflow (PRD §23–§25): reindex current state, diff, compare against the frozen
// baseline analysis — the approved one by default, or an explicitly allowed unapproved draft
// (labeled provisional throughout) — and evaluate §27 rules. Fully deterministic and offline;
// the baseline analysis is never modified.

export interface ReviewBundle {
  readonly review: ImplementationReview;
  readonly analysis: ImpactAnalysis;
  /** Whether the baseline is a human-approved contract or a draft prediction (provisional). */
  readonly baselineAuthority: BaselineAuthority;
  readonly violations: readonly RuleViolation[];
  /** Item 13: what the review document needs to split its findings by kind and state its scope. */
  readonly breakdownContext: ReviewBreakdownContext;
  /**
   * ADR-0017/0021 — the plan-as-contract result, computed ONCE here so the shells return the same
   * block the persisted artifact records; without this the findings were archived and never shown.
   */
  readonly planContract?: CliReviewOutput['planContract'];
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
  baselineOptions: ReviewBaselineOptions = {},
): Promise<Failable<ReviewBundle>> => {
  const baseline = await loadReviewBaseline(rootDir, baselineOptions);
  if (!baseline.ok) {
    return baseline;
  }
  const analysis = baseline.value.analysis;
  const specification = await loadSpecification(
    rootDir,
    analysis.specificationId,
    analysis.specificationVersion,
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
  return compareAgainstBaseline({
    rootDir,
    target,
    analysis,
    baselineAuthority: baseline.value.authority,
    specification: specification.value,
    diff: diff.value,
    reviewSnapshotId: indexed.value.snapshot.id,
  });
};

interface CompareInputs {
  readonly rootDir: string;
  readonly target: ReviewTarget;
  readonly analysis: ImpactAnalysis;
  readonly baselineAuthority: BaselineAuthority;
  readonly specification: Specification;
  readonly diff: GitDiffResult;
  readonly reviewSnapshotId: string;
}

/**
 * ADR-0017 — the plan-contract block: the approved design checked against the diff rather than
 * archived alongside it. Computed once per review; the persisted artifact and every shell's
 * returned document carry the SAME block.
 */
const planContractDto = (context: PlanContractInput): CliReviewOutput['planContract'] => {
  const contract = reviewAgainstPlan(context);
  return {
    findings: contract.findings.map(toFindingDto),
    unplannedPaths: [...contract.unplannedPaths],
    unchangedExpectedPaths: [...contract.unchangedExpectedPaths],
  };
};

/** Both graphs a comparison needs: the one the baseline was bound to, and the one just indexed. */
const loadComparisonGraphs = async (
  store: Parameters<Parameters<typeof withIndexStore>[1]>[0],
  analysis: ImpactAnalysis,
  reviewSnapshotId: string,
): Promise<Failable<{ approved: KnowledgeGraph; current: KnowledgeGraph }>> => {
  const approvedGraph = await loadGraphAt(store, analysis.repositorySnapshotId, 'approved');
  if (!approvedGraph.ok) {
    return approvedGraph;
  }
  if (approvedGraph.value.nodes.size === 0 && analysis.requirementImpacts.length > 0) {
    return failWith(
      'indexingFailure',
      `baseline snapshot ${analysis.repositorySnapshotId} is no longer in the local index — the cache was rebuilt since the analysis was created`,
    );
  }
  const currentGraph = await loadGraphAt(store, reviewSnapshotId, 'current');
  if (!currentGraph.ok) {
    return currentGraph;
  }
  return { ok: true, value: { approved: approvedGraph.value, current: currentGraph.value } };
};

const compareAgainstBaseline = async (inputs: CompareInputs): Promise<Failable<ReviewBundle>> => {
  const { rootDir, analysis, specification, diff, reviewSnapshotId, target } = inputs;
  return withIndexStore(rootDir, async (store) => {
    const graphs = await loadComparisonGraphs(store, analysis, reviewSnapshotId);
    if (!graphs.ok) {
      return graphs;
    }
    const approvedGraph = { value: graphs.value.approved };
    const currentGraph = { value: graphs.value.current };
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
    return finalizeReview(inputs, {
      review: review.value,
      approvedGraph: approvedGraph.value,
      currentGraph: currentGraph.value,
      violations: violations.value,
    });
  });
};

interface FinalizeInputs extends ComparedGraphs {
  readonly violations: readonly RuleViolation[];
}

/**
 * Story 11.2 + ADR-0017/0021: assemble the breakdown, check the plan contract, persist the
 * artifact (so accepted-deviation decisions have something to append to — a re-run is a NEW
 * artifact, acceptance never carries over), and return the bundle every shell renders from.
 */
const finalizeReview = async (
  inputs: CompareInputs,
  compared: FinalizeInputs,
): Promise<Failable<ReviewBundle>> => {
  const breakdownContext = await assembleBreakdownContext(inputs, compared);
  const planContract = planContractDto({
    rootDir: inputs.rootDir,
    analysis: inputs.analysis,
    review: compared.review,
    approvedGraph: compared.approvedGraph,
    currentGraph: compared.currentGraph,
  });
  const persisted = persistWithPlanContract(inputs, compared, breakdownContext, planContract);
  if (!persisted.ok) {
    return persisted;
  }
  recordReviewLearning(inputs.rootDir, compared.review.changedFiles);
  return {
    ok: true,
    value: {
      review: compared.review,
      analysis: inputs.analysis,
      baselineAuthority: inputs.baselineAuthority,
      violations: compared.violations,
      breakdownContext,
      ...(planContract === undefined ? {} : { planContract }),
    },
  };
};

interface ComparedGraphs {
  readonly review: ImplementationReview;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
}

/** Build the §38.2 document (plan contract attached, ADR-0017) and persist it (§24.1). */
const persistWithPlanContract = (
  inputs: CompareInputs,
  compared: FinalizeInputs,
  breakdownContext: ReviewBreakdownContext,
  planContract: CliReviewOutput['planContract'],
): Failable<void> =>
  persistReviewDocument(
    inputs.rootDir,
    buildReviewOutput(compared.review, inputs.analysis, compared.violations, {
      breakdownContext,
      planContract,
      // The stored artifact is the system of record: it keeps every finding, and the wire cap
      // applies only to what a caller is handed (ADR-0022).
      boundFindings: false,
    }),
  );

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
