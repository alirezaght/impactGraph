import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateSample,
  fixtureRepoPath,
  reportPlanningSignal,
  reportPossibleTier,
  SAMPLE_EVALUATIONS,
} from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { performIndexRun } from './indexing.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type {
  EvaluationResult,
  PlanningSignalReport,
  PossibleTierReport,
} from '@impactgraph/test-kit';

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
// The metric computation itself lives in test-kit (evaluation-metrics.ts), beside the
// ground-truth types it interprets; this file is the harness and the gates.

/** ts-basic as a real git repository, initialized and indexed — the eval precondition. */
const prepareIndexedFixture = async (): Promise<string> => {
  const repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-eval-'));
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
  return repoDir;
};

const analyzeAllSamples = async (
  repoDir: string,
): Promise<{
  results: EvaluationResult[];
  possibleReports: (PossibleTierReport & { name: string })[];
  planningReports: (PlanningSignalReport & { name: string })[];
}> => {
  const results: EvaluationResult[] = [];
  const possibleReports: (PossibleTierReport & { name: string })[] = [];
  const planningReports: (PlanningSignalReport & { name: string })[] = [];
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
    results.push(evaluateSample(sample, built.value.analysis, built.value.graph, requirementCount));
    possibleReports.push({
      name: sample.name,
      ...reportPossibleTier(sample, built.value.analysis, built.value.graph, requirementCount),
    });
    planningReports.push({
      name: sample.name,
      ...reportPlanningSignal(sample, built.value.analysis, built.value.graph),
    });
  }
  return { results, possibleReports, planningReports };
};

/**
 * ADR-0025. Two numbers, and the second is the one that matters.
 *
 * The share says how much of the analysis the primary view now shows; a low share on a broad
 * specification is the expected result, not a regression. The RETENTION column says whether
 * narrowing cost anything: a ground-truth direct impact demoted to context would be a smaller
 * graph that is also a worse one, which is the failure mode this whole change has to avoid.
 */
const printPlanningSignal = (
  reports: readonly (PlanningSignalReport & { name: string })[],
): void => {
  // eslint-disable-next-line no-console
  console.table(
    reports.map((report) => ({
      sample: report.name,
      total: report.total,
      planning: report.planningImpacts,
      context: report.dependencyContext,
      leads: report.investigationLeads,
      share: report.planningShare.toFixed(2),
      directRetained: `${String(report.retainedDirectImpacts)}/${String(report.expectedDirectImpacts)}`,
      possibleBefore: report.possibleStrictBefore?.toFixed(2) ?? '\u2014',
      possibleAfter: report.possibleStrictAfter?.toFixed(2) ?? '\u2014',
    })),
  );
  const sum = (pick: (report: PlanningSignalReport) => number): number =>
    reports.reduce((total, report) => total + pick(report), 0);
  const total = sum((report) => report.total);
  const planning = sum((report) => report.planningImpacts);
  // eslint-disable-next-line no-console
  console.log(
    [
      `AGGREGATE planning signal: ${String(planning)} of ${String(total)} impacts are planning decisions (${(planning / total).toFixed(3)})`,
      `  dependency context ${String(sum((report) => report.dependencyContext))}`,
      `  investigation leads ${String(sum((report) => report.investigationLeads))}`,
      `  ground-truth direct impacts retained in the primary view ${String(sum((report) => report.retainedDirectImpacts))}/${String(sum((report) => report.expectedDirectImpacts))}`,
      `  possible-tier candidates: ${String(sum((report) => report.possibleKept))} of ${String(sum((report) => report.possibleCandidates))} kept in the primary view`,
      `  of those, ground truth calls unsupported: ${JSON.stringify(reports.flatMap((report) => report.keptButUnsupported))}`,
    ].join('\n'),
  );
};

describe('impact-quality evaluation on the reference repository (PRD §41, §46)', () => {
  let repoDir: string;
  let results: EvaluationResult[] = [];
  let possibleReports: (PossibleTierReport & { name: string })[] = [];
  let planningReports: (PlanningSignalReport & { name: string })[] = [];

  beforeAll(async () => {
    repoDir = await prepareIndexedFixture();
    ({ results, possibleReports, planningReports } = await analyzeAllSamples(repoDir));
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
        utility: report.weightedUtility?.toFixed(2) ?? '—',
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

  /**
   * ADR-0025. Two numbers, and the second is the one that matters.
   *
   * The share says how much of the analysis the primary view now shows; a low share on a broad
   * specification is the expected result, not a regression. The RETENTION column says whether
   * narrowing cost anything: a ground-truth direct impact demoted to context would be a smaller
   * graph that is also a worse one, which is the failure mode this whole change has to avoid.
   */
  it('reports the planning-signal split and what narrowing the primary view cost', () => {
    printPlanningSignal(planningReports);
    expect(planningReports.length).toBeGreaterThan(0);
  });

  it('never demotes a ground-truth direct impact out of the primary planning view', () => {
    for (const report of planningReports) {
      expect(report.demotedDirectImpacts, `${report.name}: demoted direct impacts`).toEqual([]);
    }
  });

  /**
   * The precision gate on the tier the noise lived in. Measured before this change: 58 `possible`
   * candidates across the samples, of which ground truth allowed 7 — strict precision 0.121. The
   * role axis keeps a handful of them, so the bound is stated in absolute terms: at most two of the
   * survivors may be candidates ground truth calls unsupported. Loosening the architectural-
   * consequence rule enough to readmit the traversal would fail here.
   */
  it('keeps almost no possible-tier candidate ground truth calls unsupported', () => {
    const kept = planningReports.flatMap((report) => report.keptButUnsupported);
    expect(kept.length, `kept unsupported: ${kept.join(', ')}`).toBeLessThanOrEqual(2);
  });

  it('the primary planning view is strictly smaller than the whole analysis', () => {
    const total = planningReports.reduce((sum, report) => sum + report.total, 0);
    const planning = planningReports.reduce((sum, report) => sum + report.planningImpacts, 0);
    expect(planning).toBeLessThan(total);
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

  it('pins the components that ought to be likely and are not, in both directions', () => {
    for (const sample of SAMPLE_EVALUATIONS) {
      const gap = sample.groundTruth.shouldBeLikelyButIsNot;
      if (gap === undefined) {
        continue;
      }
      const result = results.find((candidate) => candidate.name === sample.name);
      for (const name of gap) {
        expect(
          result?.relevantNames,
          `${sample.name}: '${name}' is a documented gap — a breaking signature change does oblige its callers, but the engine models no change kind and holds them at possible. If this now passes, change-contract semantics landed and the pin should be deleted deliberately.`,
        ).not.toContain(name);
      }
    }
  });

  // Mirrors the cross-stack requiredTier gate. `mustNotContain` is the half that does work here:
  // a stem-covered near-name (ADR-0016) is legitimately surfaced at likely, so `forbiddenImpacts`
  // cannot express the actual invariant — that the guess never becomes an obligation.
  it('puts the right components at the required tier where ground truth pins it', () => {
    for (const sample of SAMPLE_EVALUATIONS) {
      const tier = sample.groundTruth.requiredTier;
      if (tier === undefined) {
        continue;
      }
      const required = results.find((result) => result.name === sample.name)?.requiredIds ?? [];
      for (const id of tier.mustContain ?? []) {
        expect(required, `${sample.name}: '${id}' must be obliged to change`).toContain(id);
      }
      for (const id of tier.mustNotContain ?? []) {
        expect(
          required,
          `${sample.name}: '${id}' may be affected but must never be presented as an obligation`,
        ).not.toContain(id);
      }
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
