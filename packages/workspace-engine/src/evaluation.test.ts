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
      results.push(
        evaluate(
          sample,
          built.value.analysis,
          built.value.graph,
          submitted.value.specification.requirements.length,
        ),
      );
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

  it('direct-impact precision holds on every exhaustively labeled sample', () => {
    const labeled = results.filter((result) => result.directPrecision !== undefined);
    expect(labeled.length).toBeGreaterThan(0);
    for (const result of labeled) {
      expect(result.directPrecision, `${result.name}: precision`).toBeGreaterThanOrEqual(0.75);
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
