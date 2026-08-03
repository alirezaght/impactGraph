import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath, SAMPLE_EVALUATIONS } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { performIndexRun } from './indexing.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { ImpactAnalysis, KnowledgeGraph, NodeId } from '@impactgraph/domain';
import type { SampleEvaluation } from '@impactgraph/test-kit';

// Story 17.5 — the repeatable §41 evaluation: hand-written ground truth (test-kit) vs the
// deterministic impact engine on the ts-basic reference repo. Run standalone via
// `pnpm eval:impact`; it also gates in the analyzers suite so metric regressions fail CI.
//
// §41 metrics covered here: direct-impact recall (>90%), unsupported-claim rate (<5%),
// surprise-detection count (§41.5), plus an OFFLINE PRECISION PROXY.
//
// §41.2 defines overall precision as the accepted-suggestion rate, which needs real user
// decisions. That is the metric that matters, but treating it as the only one left recall as the
// sole gate — and a recall-only gate cannot fail a result that adds false positives. An analysis
// with 102 spurious impacts passed CI unnoticed for exactly that reason.
//
// The proxy: where a sample carries a CLOSED `allowedImpacts` set, anything at required/likely
// outside it is a false positive and precision is computable. Samples without that set report
// precision as undefined rather than computing it against an incomplete list.

interface EvaluationResult {
  readonly name: string;
  readonly recall: number;
  readonly unsupportedClaimRate: number;
  readonly surpriseCount: number;
  /** Precision over required/likely against the closed set; undefined when unlabeled. */
  readonly directPrecision: number | undefined;
  /** Total impacts per labeled component — how much unlabeled noise rides along. */
  readonly candidateInflation: number | undefined;
  /** Names that must never appear and did. Always gated: any hit is a regression. */
  readonly forbiddenHits: readonly string[];
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

interface PossibleTierReport {
  readonly total: number;
  readonly labelled: number;
  readonly strictPrecision: number | undefined;
  readonly inclusivePrecision: number | undefined;
  readonly reviewNeeded: number;
  readonly perRequirement: number;
  readonly traversalOnly: number;
  readonly singleWeakEdge: number;
  readonly byDistance: Record<string, number>;
  readonly byMechanism: Record<string, number>;
  readonly unsupportedByAnchor: Record<string, number>;
  readonly unsupportedByFirstEdge: Record<string, number>;
}

const reportPossibleTier = (
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

const evaluate = (
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
          ? impacts.length === 0
            ? 0
            : Number.POSITIVE_INFINITY
          : impacts.length / allowed.size,
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

describe('impact-quality evaluation on the reference repository (PRD §41, §46)', () => {
  let repoDir: string;
  const results: EvaluationResult[] = [];
  const possibleReports: (PossibleTierReport & { name: string })[] = [];

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-eval-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'eval@test.dev');
    git('config', 'user.name', 'Eval');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    git('add', '.');
    git('commit', '-m', 'init impactgraph');
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }

    for (const sample of SAMPLE_EVALUATIONS) {
      const submitted = await submitSpecification({
        rootDir: repoDir,
        specName: sample.specFileName,
        rawText: sample.specText,
      });
      if (!submitted.ok) {
        throw new Error(`${sample.name}: ${submitted.error.message}`);
      }
      const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
      if (!built.ok) {
        throw new Error(`${sample.name}: ${built.error.message}`);
      }
      const requirementCount = submitted.value.specification.requirements.length;
      results.push(evaluate(sample, built.value.analysis, built.value.graph, requirementCount));
      possibleReports.push({
        name: sample.name,
        ...reportPossibleTier(sample, built.value.analysis, built.value.graph, requirementCount),
      });
    }
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('reports every §41 metric for every sample specification', () => {
    expect(results).toHaveLength(SAMPLE_EVALUATIONS.length);
    for (const result of results) {
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.unsupportedClaimRate).toBeGreaterThanOrEqual(0);
    }
    // eslint-disable-next-line no-console
    console.table(
      results.map((result) => ({
        sample: result.name,
        recall: result.recall.toFixed(2),
        precision: result.directPrecision?.toFixed(2) ?? '—',
        inflation: result.candidateInflation?.toFixed(2) ?? '—',
        possiblePerReq: result.possiblePerRequirement.toFixed(1),
        traversalOnly: result.traversalOnlyShare.toFixed(2),
        testOnly: result.testOnlyAnchorRate.toFixed(2),
        forbidden: result.forbiddenHits.length,
      })),
    );
  });

  it('direct-impact recall is above the §41.1 target (>90%) on every sample', () => {
    for (const result of results) {
      expect(result.recall, `${result.name}: recall`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('unsupported-claim rate stays under the §41.3 target (<5%)', () => {
    for (const result of results) {
      expect(result.unsupportedClaimRate, `${result.name}: unsupported`).toBeLessThan(0.05);
    }
  });

  // The gates below are the precision half of the harness. Thresholds were chosen from the
  // measured distribution (precision 0.80–1.00, inflation 1.00–3.50, median 1.92) with headroom,
  // not from intuition — see the console.table above. They exist to make a false-positive
  // regression fail: the analysis that produced 102 spurious impacts scored precision 0.00 and
  // inflation ~50, so either gate would have stopped it.

  it('reports the possible-tier labelling and its noise distributions', () => {
    const withCandidates = possibleReports.filter((report) => report.total > 0);
    // eslint-disable-next-line no-console
    console.table(
      withCandidates.map((report) => ({
        sample: report.name,
        possible: report.total,
        labelled: `${String(report.labelled)}/${String(report.total)}`,
        strict: report.strictPrecision?.toFixed(2) ?? '—',
        inclusive: report.inclusivePrecision?.toFixed(2) ?? '—',
        review: report.reviewNeeded,
        perReq: report.perRequirement.toFixed(1),
        traversalOnly: report.traversalOnly,
        weakEdge: report.singleWeakEdge,
      })),
    );
    const total = withCandidates.reduce((sum, report) => sum + report.total, 0);
    const allowed = withCandidates.reduce(
      (sum, report) => sum + Math.round((report.strictPrecision ?? 0) * report.total),
      0,
    );
    const allowedOrPlausible = withCandidates.reduce(
      (sum, report) => sum + Math.round((report.inclusivePrecision ?? 0) * report.total),
      0,
    );
    const merge = (pick: (report: PossibleTierReport) => Record<string, number>) =>
      withCandidates.reduce<Record<string, number>>((acc, report) => {
        for (const [key, value] of Object.entries(pick(report))) {
          acc[key] = (acc[key] ?? 0) + value;
        }
        return acc;
      }, {});
    // eslint-disable-next-line no-console
    console.log(
      [
        `AGGREGATE possible-tier candidates: ${String(total)}`,
        `  strict precision    ${(allowed / total).toFixed(3)}  (allowed ${String(allowed)})`,
        `  inclusive precision ${(allowedOrPlausible / total).toFixed(3)}  (allowed+plausible ${String(allowedOrPlausible)})`,
        `  by distance          ${JSON.stringify(merge((r) => r.byDistance))}`,
        `  by anchor mechanism  ${JSON.stringify(merge((r) => r.byMechanism))}`,
        `  unsupported by anchor     ${JSON.stringify(merge((r) => r.unsupportedByAnchor))}`,
        `  unsupported by first edge ${JSON.stringify(merge((r) => r.unsupportedByFirstEdge))}`,
      ].join('\n'),
    );
    expect(total).toBeGreaterThan(0);
  });

  it('every possible-tier candidate carries a judgment', () => {
    for (const report of possibleReports) {
      expect(report.labelled, `${report.name}: unlabelled possible candidates`).toBe(report.total);
    }
  });

  it('direct-impact precision holds on every exhaustively labeled sample', () => {
    const gapByName = new Map(
      SAMPLE_EVALUATIONS.filter((sample) => sample.groundTruth.knownDirectPrecision !== undefined) //
        .map((sample) => [sample.name, sample.groundTruth.knownDirectPrecision]),
    );
    const labeled = results.filter((result) => result.directPrecision !== undefined);
    expect(labeled.length).toBeGreaterThan(0);
    for (const result of labeled) {
      const gap = gapByName.get(result.name);
      if (gap === undefined) {
        expect(result.directPrecision, `${result.name}: precision`).toBeGreaterThanOrEqual(0.75);
        continue;
      }
      // Pinned exactly: this must fail if the documented gap closes, so closing it gets reviewed.
      expect(result.directPrecision, `${result.name}: documented gap — ${gap.reason}`).toBeCloseTo(
        gap.value,
        2,
      );
    }
  });

  it('never surfaces a component pinned as a known false positive', () => {
    for (const result of results) {
      expect(result.forbiddenHits, `${result.name}: forbidden`).toEqual([]);
    }
  });

  it('candidate inflation stays bounded per sample and at the median', () => {
    const inflations = results
      .map((result) => result.candidateInflation)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    for (const result of results) {
      if (result.candidateInflation !== undefined) {
        expect(result.candidateInflation, `${result.name}: inflation`).toBeLessThanOrEqual(5);
      }
    }
    const middle = Math.floor(inflations.length / 2);
    const median =
      inflations.length % 2 === 0
        ? ((inflations[middle - 1] ?? 0) + (inflations[middle] ?? 0)) / 2
        : (inflations[middle] ?? 0);
    expect(median, 'median inflation').toBeLessThanOrEqual(2.5);
  });

  it('surfaces the ground-truth minimum of dependencies the specs never named (§41.5/§46)', () => {
    for (const [index, sample] of SAMPLE_EVALUATIONS.entries()) {
      expect(
        results[index]?.surpriseCount ?? 0,
        `${sample.name}: surprises`,
      ).toBeGreaterThanOrEqual(sample.groundTruth.minSurprises);
    }
  });
});
