// The §41 metric computation over one analyzed sample. Lives beside the ground-truth types it
// interprets (evaluation.ts) so the evaluation test file holds only the harness and the gates —
// what the numbers MEAN is decided here, in one place, under the effective-LOC budget.

import type { SampleEvaluation } from './evaluation.js';
import type { ImpactAnalysis, KnowledgeGraph, NodeId } from '@impactgraph/domain';

export interface EvaluationResult {
  readonly name: string;
  readonly recall: number;
  readonly unsupportedClaimRate: number;
  readonly surpriseCount: number;
  /** Precision over required/likely against the closed set; undefined when unlabeled. */
  readonly directPrecision: number | undefined;
  /**
   * Over-promotion at the required/likely tier: how many components are presented as confident per
   * component that legitimately belongs there. Deliberately tier-scoped — measuring TOTAL impacts
   * against the required/likely allowed set conflates two things, because the possible tier is meant
   * to be exploratory, and it made the ratio worsen whenever ground truth got stricter rather than
   * when the engine got worse. Possible-tier volume is measured separately.
   */
  readonly candidateInflation: number | undefined;
  /** Names that must never appear and did. Always gated: any hit is a regression. */
  readonly forbiddenHits: readonly string[];
  /** Names at required/likely, for pinning documented gaps. */
  readonly relevantNames: readonly string[];
  /** Node ids at `required`, for the ground-truth requiredTier pins (ADR-0016 ceiling proof). */
  readonly requiredIds: readonly string[];
  /** Diagnostics, reported but not gated — they describe shape, not correctness. */
  readonly possiblePerRequirement: number;
  readonly traversalOnlyShare: number;
  readonly testOnlyAnchorRate: number;
}

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

const tally = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};

/** The relationship the walk crossed first, read back off the dependency path. */
const firstEdgeType = (graph: KnowledgeGraph, path: readonly string[]): string => {
  const [from, to] = path;
  if (from === undefined || to === undefined) {
    return 'none';
  }
  for (const edgeId of [
    ...(graph.outgoing.get(from as NodeId) ?? []),
    ...(graph.incoming.get(from as NodeId) ?? []),
  ]) {
    const edge = graph.edges.get(edgeId);
    if (edge !== undefined && (edge.sourceId === to || edge.targetId === to)) {
      return edge.type;
    }
  }
  return 'unknown';
};

const EDGE_SIGNALS = new Set([
  'direct-import',
  'direct-function-call',
  'direct-data-access',
  'event-relationship',
  'test-association',
  'api-ownership',
  'framework-convention',
]);

const MECHANISM_SIGNALS = new Set([
  'exact-concept-to-symbol-match',
  'semantic-concept-match',
  'human-confirmed-mapping',
]);

export interface PossibleTierReport {
  readonly total: number;
  readonly labelled: number;
  readonly strictPrecision: number | undefined;
  readonly inclusivePrecision: number | undefined;
  /**
   * A smoother comparison than the two bounds: allowed counts fully, plausible half. Diagnostic
   * only — strict and inclusive precision remain the authoritative figures, because a single
   * weighted number hides which side of the bound a change moved.
   */
  readonly weightedUtility: number | undefined;
  readonly reviewNeeded: number;
  readonly perRequirement: number;
  readonly traversalOnly: number;
  readonly singleWeakEdge: number;
  readonly byDistance: Record<string, number>;
  readonly byMechanism: Record<string, number>;
  readonly unsupportedByAnchor: Record<string, number>;
  readonly unsupportedByFirstEdge: Record<string, number>;
}

export const reportPossibleTier = (
  sample: SampleEvaluation,
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  requirementCount: number,
): PossibleTierReport => {
  const possible = analysis.requirementImpacts.filter((impact) => impact.likelihood === 'possible');
  const labels = new Map(
    (sample.groundTruth.possibleTier ?? []).map((entry) => [entry.nodeId, entry]),
  );
  const verdictOf = (nodeId: string): string => labels.get(nodeId)?.verdict ?? 'unlabelled';
  const labelled = possible.filter((impact) => labels.has(impact.nodeId));
  const counted = (verdict: string): number =>
    possible.filter((impact) => verdictOf(impact.nodeId) === verdict).length;
  const allowed = counted('allowed');
  const plausible = counted('plausible');
  const unsupported = possible.filter((impact) => verdictOf(impact.nodeId) === 'unsupported');
  const edgeSignalCount = (impact: ImpactAnalysis['requirementImpacts'][number]): number =>
    impact.confidenceSignals.filter((signal) => EDGE_SIGNALS.has(signal.type)).length;
  return {
    total: possible.length,
    labelled: labelled.length,
    strictPrecision: possible.length === 0 ? undefined : share(allowed, possible.length),
    inclusivePrecision:
      possible.length === 0 ? undefined : share(allowed + plausible, possible.length),
    weightedUtility:
      possible.length === 0 ? undefined : share(allowed + 0.5 * plausible, possible.length),
    reviewNeeded: possible.filter((impact) => labels.get(impact.nodeId)?.reviewNeeded === true)
      .length,
    perRequirement: share(possible.length, requirementCount),
    traversalOnly: possible.filter((impact) => impact.directness === 'indirect').length,
    singleWeakEdge: possible.filter((impact) => edgeSignalCount(impact) <= 1).length,
    byDistance: tally(
      possible.map((impact) => `d${String(Math.max(0, impact.dependencyPath.length - 1))}`),
    ),
    byMechanism: tally(
      possible.map(
        (impact) =>
          impact.confidenceSignals.find((signal) => MECHANISM_SIGNALS.has(signal.type))?.type ??
          'none',
      ),
    ),
    unsupportedByAnchor: tally(
      unsupported
        .map((impact) => impact.dependencyPath[0] ?? 'none')
        .map((id) => id.split('#')[1] ?? id),
    ),
    unsupportedByFirstEdge: tally(
      unsupported.map((impact) => firstEdgeType(graph, impact.dependencyPath)),
    ),
  };
};

export const evaluateSample = (
  sample: SampleEvaluation,
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  requirementCount: number,
): EvaluationResult => {
  const nameOf = (nodeId: string): string => graph.nodes.get(nodeId as NodeId)?.name ?? nodeId;
  const impacts = analysis.requirementImpacts;
  const relevant = impacts.filter(
    (impact) => impact.likelihood === 'required' || impact.likelihood === 'likely',
  );
  const names = new Set(relevant.map((impact) => nameOf(impact.nodeId)));
  const allNames = new Set(impacts.map((impact) => nameOf(impact.nodeId)));
  const { directImpacts, allowedImpacts, forbiddenImpacts } = sample.groundTruth;
  const found = directImpacts.filter((name) => names.has(name));
  const unsupported = analysis.warnings.filter(
    (warning) => warning.code === 'unsupported-claim' || warning.code === 'invalid-reference',
  ).length;
  const allowed = allowedImpacts === undefined ? undefined : new Set(allowedImpacts);
  return {
    name: sample.name,
    recall: directImpacts.length === 0 ? 1 : found.length / directImpacts.length,
    unsupportedClaimRate: share(unsupported, impacts.length),
    surpriseCount: [...names].filter((name) => !sample.specText.includes(name)).length,
    relevantNames: [...names],
    requiredIds: impacts
      .filter((impact) => impact.likelihood === 'required')
      .map((impact) => impact.nodeId),
    // Predicting nothing where nothing is expected is perfect precision, not zero — but
    // predicting anything against an empty allowed set is unbounded inflation, which is the
    // signal that catches a sample whose correct answer is silence.
    directPrecision:
      allowed === undefined
        ? undefined
        : names.size === 0
          ? 1
          : share([...names].filter((name) => allowed.has(name)).length, names.size),
    candidateInflation:
      allowed === undefined
        ? undefined
        : allowed.size === 0
          ? names.size === 0
            ? 0
            : Number.POSITIVE_INFINITY
          : names.size / allowed.size,
    forbiddenHits: (forbiddenImpacts ?? []).filter((name) => allNames.has(name)),
    possiblePerRequirement: share(
      impacts.filter((impact) => impact.likelihood === 'possible').length,
      requirementCount,
    ),
    traversalOnlyShare: share(
      impacts.filter((impact) => impact.directness === 'indirect').length,
      impacts.length,
    ),
    testOnlyAnchorRate: share(
      impacts.filter((impact) =>
        impact.confidenceSignals.some((signal) => signal.type === 'test-only-match'),
      ).length,
      impacts.length,
    ),
  };
};
