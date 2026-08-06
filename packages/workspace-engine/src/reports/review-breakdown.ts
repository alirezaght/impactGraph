import { evidenceTypesOf, primaryEvidenceType, nonGoalsOf } from '@impactgraph/domain';

import type { CliReviewBreakdown } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  NodeId,
  Specification,
} from '@impactgraph/domain';

/**
 * The item-13 review breakdown: what the review found, split by the distinction that decides what a
 * reader does about it.
 *
 * The existing findings list answers "matched or not". That is not enough to act on. A missed change
 * to an existing file is a gap in the prediction; a missed NEW file is a category the tool cannot
 * predict by path and should have predicted by kind. A lexical-only prediction that did change is a
 * near-miss worth learning from; a `required` prediction that did not change is a false claim. All
 * four used to arrive as one undifferentiated list.
 */

export interface ReviewBreakdownInput {
  readonly review: ImplementationReview;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  /** The graph the review ran against — for the paths and evidence bases of predicted impacts. */
  readonly currentGraph: KnowledgeGraph;
  /** Changed paths that are additions, from the diff. Absent → additions are not distinguished. */
  readonly addedPaths?: readonly string[];
}

const ASSET_PATH = /(^|\/)(locales?|i18n|translations?)(\/|$)|\.(json|ya?ml|toml|tf|tfvars)$/i;
const CONFIG_PATH = /(^|\/)(config|configuration|infra|terraform|deploy)(\/|\.)|\.env(\.|$)/i;
const CONTRACT_PATH = /(openapi|asyncapi|swagger|\.schema\.json|\.proto$)/i;
const MIGRATION_PATH = /(^|\/)(migrations?|migrate|alembic\/versions|flyway|liquibase)(\/|$)/i;

interface PredictedImpact {
  readonly path: string;
  readonly likelihood: string;
  readonly basis: string;
  readonly nodeName: string;
}

const predictedImpacts = (input: ReviewBreakdownInput): readonly PredictedImpact[] => {
  const impacts: PredictedImpact[] = [];
  for (const impact of input.analysis.requirementImpacts) {
    const node = input.currentGraph.nodes.get(impact.nodeId as NodeId);
    if (node?.path === undefined) {
      continue;
    }
    impacts.push({
      path: node.path,
      likelihood: impact.likelihood,
      basis: primaryEvidenceType(evidenceTypesOf(impact)),
      nodeName: node.name,
    });
  }
  return impacts;
};

/**
 * Non-goal contradictions: the specification said not to touch a component, and the implementation
 * touched it. Reported plainly, without a verdict — a non-goal can be overtaken by events, and that
 * is a human call (§43.6).
 */
const nonGoalContradictions = (
  input: ReviewBreakdownInput,
  changed: ReadonlySet<string>,
): CliReviewBreakdown['nonGoalContradictions'] => {
  const contradictions: { statement: string; changedPaths: string[] }[] = [];
  for (const note of nonGoalsOf(input.specification.notes)) {
    // A non-goal names components, not paths, so the join is by the excluded impacts the analysis
    // already resolved — the same resolution the analysis used, not a fresh guess.
    const excluded = input.analysis.requirementImpacts.filter(
      (impact) => impact.likelihood === 'excluded',
    );
    const paths = excluded
      .map((impact) => input.currentGraph.nodes.get(impact.nodeId as NodeId)?.path)
      .filter((path): path is string => path !== undefined && changed.has(path));
    if (paths.length > 0) {
      contradictions.push({ statement: note.statement, changedPaths: [...new Set(paths)].sort() });
    }
  }
  return contradictions;
};

export const buildReviewBreakdown = (
  input: ReviewBreakdownInput,
): CliReviewBreakdown => {
  const changed = new Set(input.review.changedFiles);
  const added = new Set(input.addedPaths ?? []);
  const predicted = predictedImpacts(input);
  const predictedPaths = new Set(predicted.map((impact) => impact.path));
  const structuralTiers = new Set(['required', 'likely', 'possible']);
  const structural = predicted.filter((impact) => structuralTiers.has(impact.likelihood));
  const structuralPaths = new Set(structural.map((impact) => impact.path));
  const byCategory = (pattern: RegExp): string[] =>
    [...changed].filter((path) => pattern.test(path)).sort();
  return {
    correctlyPredictedStructural: [...structuralPaths].filter((path) => changed.has(path)).sort(),
    // Measured against STRUCTURAL predictions only. A lexical-only prediction is not a prediction —
    // that is the whole point of the tier — so a file surfaced lexically and then changed is BOTH a
    // prediction gap and a near-miss, and it appears in both rows. Counting it as predicted would
    // flatter the tool for a claim it explicitly declined to make.
    //
    // Split deliberately: a missed EXISTING file is a prediction gap; a missed NEW file is a category
    // the tool cannot predict by path and should have predicted by kind (item 8).
    missedChangedFiles: [...changed]
      .filter((path) => !added.has(path) && !structuralPaths.has(path))
      .sort(),
    missedNewFiles: [...added].filter((path) => !structuralPaths.has(path)).sort(),
    // A lexical-only prediction that DID change is the most informative row in the report: the tool
    // saw the component and declined to claim it. It is evidence for promotion, not a success.
    lexicalOnlyThatChanged: predicted
      .filter((impact) => impact.likelihood === 'lexical-only' && changed.has(impact.path))
      .map((impact) => ({ path: impact.path, name: impact.nodeName }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    falseStrongPredictions: predicted
      .filter(
        (impact) =>
          (impact.likelihood === 'required' || impact.likelihood === 'likely') &&
          !changed.has(impact.path),
      )
      .map((impact) => ({
        path: impact.path,
        name: impact.nodeName,
        likelihood: impact.likelihood,
        basis: impact.basis,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    // The review's own `unexpected` category, which is a narrower claim than "not predicted": it
    // means the approved analysis said nothing about this file at ANY tier.
    unexpectedChanges: [...changed]
      .filter((path) => !predictedPaths.has(path) && !added.has(path))
      .sort(),
    asyncOrBoundaryChanges: input.review.findings
      .filter((finding) =>
        finding.filePaths.some((path) => /pubsub|topic|subscription|outbox|queue|event/i.test(path)),
      )
      .map((finding) => finding.nodeName)
      .sort(),
    configurationAndAssetChanges: [...new Set([...byCategory(ASSET_PATH), ...byCategory(CONFIG_PATH)])].sort(),
    contractChanges: byCategory(CONTRACT_PATH),
    migrationChanges: byCategory(MIGRATION_PATH),
    nonGoalContradictions: nonGoalContradictions(input, changed),
    scope: scopeOf(input),
  };
};

/**
 * The analyzed scope, stated on every review (item 13: "Always state the analyzed scope").
 *
 * Without it a review's silence is unreadable: "no async changes" and "async relationships were not
 * indexed in this workspace" produce the same empty list.
 */
const scopeOf = (input: ReviewBreakdownInput): CliReviewBreakdown['scope'] => ({
  approvedSnapshotId: input.analysis.repositorySnapshotId,
  reviewSnapshotId: input.review.reviewSnapshotId,
  target: input.review.target,
  changedFileCount: input.review.changedFiles.length,
  indexedComponentCount: input.currentGraph.nodes.size,
  limitations: [
    'Only this workspace was compared; repositories not registered in the workspace were not analyzed.',
    ...(input.addedPaths === undefined
      ? ['Added files were not distinguished from modified files by the caller.']
      : []),
  ],
});
