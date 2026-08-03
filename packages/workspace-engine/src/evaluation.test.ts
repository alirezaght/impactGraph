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
// surprise-detection count (§41.5). Overall precision (§41.2) is the accepted-suggestion
// rate — it needs real user decisions and cannot be computed offline; it is intentionally
// absent rather than faked.

interface EvaluationResult {
  readonly name: string;
  readonly recall: number;
  readonly unsupportedClaimRate: number;
  readonly surpriseCount: number;
}

const evaluate = (
  sample: SampleEvaluation,
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): EvaluationResult => {
  const relevant = analysis.requirementImpacts.filter(
    (impact) => impact.likelihood === 'required' || impact.likelihood === 'likely',
  );
  const names = new Set(
    relevant.map((impact) => graph.nodes.get(impact.nodeId as NodeId)?.name ?? impact.nodeId),
  );
  const found = sample.groundTruth.directImpacts.filter((name) => names.has(name));
  const unsupported = analysis.warnings.filter(
    (warning) => warning.code === 'unsupported-claim' || warning.code === 'invalid-reference',
  ).length;
  const surprises = [...names].filter((name) => !sample.specText.includes(name));
  return {
    name: sample.name,
    recall:
      sample.groundTruth.directImpacts.length === 0
        ? 1
        : found.length / sample.groundTruth.directImpacts.length,
    unsupportedClaimRate:
      analysis.requirementImpacts.length === 0
        ? 0
        : unsupported / analysis.requirementImpacts.length,
    surpriseCount: surprises.length,
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
      results.push(evaluate(sample, built.value.analysis, built.value.graph));
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

  it('surfaces the ground-truth minimum of dependencies the specs never named (§41.5/§46)', () => {
    for (const [index, sample] of SAMPLE_EVALUATIONS.entries()) {
      expect(
        results[index]?.surpriseCount ?? 0,
        `${sample.name}: surprises`,
      ).toBeGreaterThanOrEqual(sample.groundTruth.minSurprises);
    }
  });
});
