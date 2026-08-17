import {
  changeExpectationOf,
  createImplementationReview,
  PREDICTIVE_LIKELIHOODS,
} from '@impactgraph/domain';

import { estimateCoverage } from './coverage.js';

import type { ChangedPath } from '../ports/git.js';
import type {
  ChangeExpectation,
  EdgeChangeSummary,
  ImpactAnalysis,
  ImplementationReview,
  KnowledgeGraph,
  NodeId,
  RequirementImpact,
  Result,
  ReviewFinding,
  ReviewTarget,
  Specification,
  ValidationError,
} from '@impactgraph/domain';

// Story 11.2 — expected-vs-actual comparison (PRD §24). Symbol-level where supported: a
// predicted symbol counts as changed when its file changed, and added/removed symbols are
// detected by graph presence. The approved analysis is never mutated — it is the frozen baseline.

export interface CompareImplementationRequest {
  readonly reviewId: string;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
  readonly changes: readonly ChangedPath[];
  readonly reviewSnapshotId: string;
  readonly target: ReviewTarget;
  readonly createdAt: string;
}

/** Internal paths that never count as implementation changes. */
const NOISE_PREFIXES = ['.impactgraph/', 'node_modules/', '.git/'];

const isNoise = (path: string): boolean => NOISE_PREFIXES.some((prefix) => path.startsWith(prefix));

const changedFileSet = (changes: readonly ChangedPath[]): Set<string> => {
  const paths = new Set<string>();
  for (const change of changes) {
    if (!isNoise(change.path)) {
      paths.add(change.path);
    }
    if (change.previousPath !== undefined && !isNoise(change.previousPath)) {
      paths.add(change.previousPath);
    }
  }
  return paths;
};

const rejectedKeys = (analysis: ImpactAnalysis): Set<string> =>
  new Set(
    analysis.userDecisions
      .filter((decision) => decision.decision === 'rejected')
      .map((decision) => `${decision.requirementId}→${decision.nodeId}`),
  );

interface ComparisonContext {
  readonly request: CompareImplementationRequest;
  readonly changedFiles: ReadonlySet<string>;
}

interface FindingDetail {
  readonly nodeName: string;
  readonly explanation: string;
  readonly filePaths: readonly string[];
}

const finding = (
  category: ReviewFinding['category'],
  impact: RequirementImpact,
  detail: FindingDetail,
): ReviewFinding => ({
  category,
  nodeId: impact.nodeId,
  nodeName: detail.nodeName,
  requirementId: impact.requirementId,
  explanation: detail.explanation,
  filePaths: detail.filePaths,
});

/**
 * ADR-0022 + regression boundaries: a surface the plan expected to leave alone. Unchanged is the
 * plan working; changed contradicts it, and whichever of the two is wrong is what a human should
 * look at.
 *
 * `preserve` is reported apart from the other two on both sides. Reuse and verification are DESIGN
 * CHOICES — an implementer who modified the surface anyway may simply have found a better route, so
 * `divergent` ("changed differently than planned") is the honest reading. A preservation
 * requirement is the AUTHOR forbidding the change, so crossing it is a violated requirement, and
 * honouring it is a verified one — never "planned reuse", which claims something the author never
 * said about how the work should be built.
 */
const classifyNoChangeExpected = (
  impact: RequirementImpact,
  expectation: Exclude<ChangeExpectation, 'must-change'>,
  detail: { name: string; path: string; changed: boolean },
): ReviewFinding => {
  const { name, path } = detail;
  if (expectation === 'preserve') {
    return detail.changed
      ? finding('guard-violated', impact, {
          nodeName: name,
          explanation: `The specification set a regression boundary around '${name}' — it must remain unchanged — but ${path} was modified.`,
          filePaths: [path],
        })
      : finding('reuse-confirmed', impact, {
          nodeName: name,
          explanation: `Regression boundary held: the specification requires '${name}' to remain unchanged, and ${path} is unchanged.`,
          filePaths: [path],
        });
  }
  if (detail.changed) {
    return finding('divergent', impact, {
      nodeName: name,
      explanation: `'${name}' was ${expectation === 'verify-only' ? 'planned as existing behaviour to verify' : 'planned as reuse'} without changes, but ${path} was modified.`,
      filePaths: [path],
    });
  }
  return finding('reuse-confirmed', impact, {
    nodeName: name,
    explanation:
      expectation === 'verify-only'
        ? `Existing behaviour verified: '${name}' was planned as verify-only and ${path} is unchanged.`
        : `Planned reuse: '${name}' was reused unchanged by design (${path}).`,
    filePaths: [path],
  });
};

const classifyImpact = (
  impact: RequirementImpact,
  context: ComparisonContext,
): ReviewFinding | undefined => {
  const { approvedGraph, currentGraph } = context.request;
  const approvedNode = approvedGraph.nodes.get(impact.nodeId as NodeId);
  const name = approvedNode?.name ?? impact.nodeId;
  const path = approvedNode?.path;
  if (path === undefined) {
    // No file binding (e.g. an event topic) — we cannot diff it. Say so, never guess (§24.1).
    return impact.likelihood === 'required'
      ? finding('unverifiable', impact, {
          nodeName: name,
          explanation: `'${name}' has no file binding — ImpactGraph cannot verify this change from the diff.`,
          filePaths: [],
        })
      : undefined;
  }
  const expectation = changeExpectationOf(impact);
  const changed = context.changedFiles.has(path);
  if (expectation !== 'must-change') {
    return classifyNoChangeExpected(impact, expectation, { name, path, changed });
  }
  if (changed) {
    return currentGraph.nodes.has(impact.nodeId as NodeId)
      ? finding('matched', impact, {
          nodeName: name,
          explanation: `Predicted ${impact.likelihood} impact changed: ${path}.`,
          filePaths: [path],
        })
      : finding('divergent', impact, {
          nodeName: name,
          explanation: `'${name}' was removed, but the approved analysis expected it to change in place.`,
          filePaths: [path],
        });
  }
  if (impact.likelihood === 'required') {
    return finding('missing', impact, {
      nodeName: name,
      explanation: `Required impact did not change and no evidence explains why: ${path}.`,
      filePaths: [path],
    });
  }
  return undefined; // an unchanged likely/possible impact is not a discrepancy
};

const coveredPaths = (
  impacts: readonly RequirementImpact[],
  context: ComparisonContext,
): Set<string> => {
  const paths = new Set<string>();
  for (const impact of impacts) {
    const node =
      context.request.approvedGraph.nodes.get(impact.nodeId as NodeId) ??
      context.request.currentGraph.nodes.get(impact.nodeId as NodeId);
    if (node?.path !== undefined) {
      paths.add(node.path);
    }
  }
  return paths;
};

/** Paths of impacts a specification non-goal excluded — a change there contradicts the exclusion. */
const excludedPaths = (context: ComparisonContext): Set<string> =>
  coveredPaths(
    context.request.analysis.requirementImpacts.filter(
      (impact) => impact.likelihood === 'excluded',
    ),
    context,
  );

const unexpectedFindings = (
  impacts: readonly RequirementImpact[],
  context: ComparisonContext,
): ReviewFinding[] => {
  const covered = coveredPaths(impacts, context);
  const excluded = excludedPaths(context);
  const findings: ReviewFinding[] = [];
  for (const change of context.request.changes) {
    if (
      isNoise(change.path) ||
      covered.has(change.path) ||
      covered.has(change.previousPath ?? '')
    ) {
      continue;
    }
    const nodeId = `file:${change.path}`;
    const node = context.request.currentGraph.nodes.get(nodeId as NodeId);
    findings.push({
      category: 'unexpected',
      nodeId,
      nodeName: node?.name ?? change.path.slice(change.path.lastIndexOf('/') + 1),
      explanation: excluded.has(change.path)
        ? `'${change.path}' was ${change.changeType} although the approved analysis excluded it (specification non-goal).`
        : `'${change.path}' was ${change.changeType} but is not part of the approved analysis.`,
      filePaths: [change.path],
    });
  }
  return findings;
};

/** Report cap on edge-change ids; anything beyond it is COUNTED, never silently dropped. */
const EDGE_CHANGE_LIMIT = 50;

const edgeChanges = (context: ComparisonContext): EdgeChangeSummary => {
  const touches = (graph: KnowledgeGraph, edgeId: string): boolean => {
    const edge = graph.edges.get(edgeId as never);
    if (edge === undefined) {
      return false;
    }
    const sourcePath = graph.nodes.get(edge.sourceId)?.path;
    const targetPath = graph.nodes.get(edge.targetId)?.path;
    return (
      (sourcePath !== undefined && context.changedFiles.has(sourcePath)) ||
      (targetPath !== undefined && context.changedFiles.has(targetPath))
    );
  };
  const { approvedGraph, currentGraph } = context.request;
  const added = [...currentGraph.edges.keys()].filter(
    (id) => !approvedGraph.edges.has(id) && touches(currentGraph, id),
  );
  const removed = [...approvedGraph.edges.keys()].filter(
    (id) => !currentGraph.edges.has(id) && touches(approvedGraph, id),
  );
  const omittedAdded = Math.max(0, added.length - EDGE_CHANGE_LIMIT);
  const omittedRemoved = Math.max(0, removed.length - EDGE_CHANGE_LIMIT);
  return {
    added: added.slice(0, EDGE_CHANGE_LIMIT),
    removed: removed.slice(0, EDGE_CHANGE_LIMIT),
    ...(omittedAdded > 0 ? { omittedAdded } : {}),
    ...(omittedRemoved > 0 ? { omittedRemoved } : {}),
  };
};

/** Expected-vs-actual comparison against the immutable approved baseline (PRD §24, §40.5). */
export const compareImplementation = (
  request: CompareImplementationRequest,
): Result<ImplementationReview, ValidationError> => {
  const context: ComparisonContext = { request, changedFiles: changedFileSet(request.changes) };
  const rejected = rejectedKeys(request.analysis);
  // Only the PREDICTIVE tiers (required/likely/possible) are predictions the review can match
  // against. A lexical-only impact is explicitly NOT a prediction, `excluded` says the
  // specification ruled the component out, and `unlikely` is a weak negative — a change in any
  // of those areas must surface as `unexpected`, never be absorbed as `matched` (§24.1).
  const impacts = request.analysis.requirementImpacts.filter(
    (impact) =>
      PREDICTIVE_LIKELIHOODS.includes(impact.likelihood) &&
      !rejected.has(`${impact.requirementId}→${impact.nodeId}`),
  );
  const findings: ReviewFinding[] = [];
  for (const impact of impacts) {
    const finding = classifyImpact(impact, context);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }
  findings.push(...unexpectedFindings(impacts, context));

  return createImplementationReview({
    id: request.reviewId,
    analysisId: request.analysis.id,
    reviewSnapshotId: request.reviewSnapshotId,
    target: request.target,
    createdAt: request.createdAt,
    changedFiles: [...context.changedFiles].sort(),
    findings,
    coverage: estimateCoverage(request.specification, findings),
    edgeChanges: edgeChanges(context),
  });
};
