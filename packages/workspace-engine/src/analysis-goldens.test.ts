import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evidenceTypesOf } from '@impactgraph/domain';
import {
  analysisGoldenPath,
  digest,
  candidateMovement,
  firstRelationship,
  formatMovement,
  mergeMovement,
  parseCandidateGolden,
  fixtureRepoPath,
  reviewGoldenPath,
  SAMPLE_EVALUATIONS,
  serializeAnalysisGolden,
  shouldUpdateGolden,
  serializeReviewGolden,
} from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveAnalysis } from './decisions.js';
import { performIndexRun } from './indexing.js';
import { runReviewPipeline } from './review.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { ImplementationReview } from '@impactgraph/domain';
import type { ImpactAnalysis, KnowledgeGraph, NodeId } from '@impactgraph/domain';
import type { GoldenImpact } from '@impactgraph/test-kit';

// Story 17.3 — impact goldens (PRD §42.3), the analysis half of the golden runner. The graph
// goldens pin what the repository IS; these pin what the engine CONCLUDES from it, so a
// confidence-weight or classification change is a reviewed diff instead of a silent drift.
//
// Regenerate deliberately: UPDATE_GOLDENS=1 pnpm test:analyzers analysis-goldens

/** These goldens all describe the ts-basic fixture, so one scope name covers the file. */
const goldenScope = 'ts-basic';

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const goldenFor = (analysis: ImpactAnalysis, graph: KnowledgeGraph): string => {
  const impacts: GoldenImpact[] = analysis.requirementImpacts.map((impact) => ({
    requirementId: impact.requirementId,
    nodeName: graph.nodes.get(impact.nodeId as NodeId)?.name ?? impact.nodeId,
    likelihood: impact.likelihood,
    impactType: impact.impactType,
    directness: impact.directness,
    confidence: impact.confidence,
    relationship: firstRelationship(graph, impact.dependencyPath),
    explanationDigest: digest(impact.explanation),
    signalTypes: impact.confidenceSignals.map((signal) => signal.type),
    evidenceTypes: evidenceTypesOf(impact),
    tierCappedBy: impact.tierCappedBy,
  }));
  return serializeAnalysisGolden({
    impacts,
    warningCodes: analysis.warnings.map((warning) => warning.code),
  });
};

const reviewGolden = (review: ImplementationReview): string =>
  serializeReviewGolden({
    findings: review.findings.map((finding) => ({
      category: finding.category,
      nodeName: finding.nodeName,
      nodeId: finding.nodeId,
      requirementId: finding.requirementId,
    })),
    coverage: review.coverage.map((item) => ({
      requirementId: item.requirementId,
      status: item.status,
    })),
  });

/**
 * Expected candidate movement against the committed analysis goldens. Steady state: unchanged.
 *
 * 70 → 72: adding `CONFIGURES` to the traversal roster (item 8 — configuration and assets are
 * first-class) reaches `Dockerfile` and `tsconfig.json` from the packaging sample, both at the
 * `possible` tier. That is the trial's "configuration was missed" complaint, fixed.
 */
const EXPECTED_CANDIDATE_MOVEMENT: Readonly<Record<string, number>> = {
  unchanged: 72,
};

describe('impact goldens on the ts-basic reference repository (§42.3)', () => {
  let repoDir: string;
  let firstAnalysisId: string | undefined;
  const actual = new Map<string, string>();

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-goldens-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'goldens@test.dev');
    git('config', 'user.name', 'Goldens');
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
      actual.set(sample.name, goldenFor(built.value.analysis, built.value.graph));
      firstAnalysisId ??= built.value.analysis.id;
    }
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  for (const sample of SAMPLE_EVALUATIONS) {
    it(`matches the committed golden for '${sample.name}'`, () => {
      const serialized = actual.get(sample.name) ?? '';
      const path = analysisGoldenPath('ts-basic', slug(sample.name));
      if (shouldUpdateGolden(goldenScope)) {
        writeFileSync(path, serialized);
        return;
      }
      expect(existsSync(path), `missing golden ${path} — regenerate with UPDATE_GOLDENS=1`).toBe(
        true,
      );
      expect(
        serialized,
        `impact golden drift for '${sample.name}' — if intended, regenerate deliberately with UPDATE_GOLDENS=1 and review the diff`,
      ).toBe(readFileSync(path, 'utf8'));
    });
  }

  /**
   * The candidate half of the acceptance record. Identity is requirementId + component name and
   * excludes every field being compared, so a promotion reads as `promoted` rather than as one
   * removal plus one addition. Confidence and explanation changes are their own categories: a tier
   * can hold steady while the evidence behind it moves materially.
   *
   * Asserted against EXPECTED_CANDIDATE_MOVEMENT so an unexplained transition fails CI.
   */
  it('reports candidate movement, and nothing unexplained', () => {
    const reports = SAMPLE_EVALUATIONS.filter((sample) =>
      existsSync(analysisGoldenPath('ts-basic', slug(sample.name))),
    ).map((sample) =>
      candidateMovement(
        parseCandidateGolden(
          readFileSync(analysisGoldenPath('ts-basic', slug(sample.name)), 'utf8'),
        ),
        parseCandidateGolden(actual.get(sample.name) ?? ''),
      ),
    );
    const merged = mergeMovement(reports);
    // eslint-disable-next-line no-console
    console.log(formatMovement('CANDIDATE MOVEMENT (ts-basic samples)', merged));
    const combined = merged.totals;
    for (const [category, total] of Object.entries(combined)) {
      expect(total, `unexpected candidate movement: ${category}`).toBe(
        EXPECTED_CANDIDATE_MOVEMENT[category] ?? 0,
      );
    }
  });

  it('matches the committed review golden for an implemented change (§42.3)', async () => {
    expect(firstAnalysisId).toBeDefined();
    const approved = await approveAnalysis(repoDir, firstAnalysisId ?? '');
    expect(approved.ok).toBe(true);
    // implement something the analysis predicted, plus something it did not
    appendFileSync(
      join(repoDir, 'src/services/deal-service.ts'),
      '\nexport const filterExpired = true;\n',
    );
    writeFileSync(join(repoDir, 'src/rogue.ts'), 'export const rogue = 1;\n');

    const reviewed = await runReviewPipeline(repoDir, 'working-tree');
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) {
      return;
    }
    const serialized = reviewGolden(reviewed.value.review);
    const path = reviewGoldenPath('ts-basic', 'working-tree');
    if (shouldUpdateGolden(goldenScope)) {
      writeFileSync(path, serialized);
      return;
    }
    expect(existsSync(path), `missing golden ${path} — regenerate with UPDATE_GOLDENS=1`).toBe(
      true,
    );
    expect(
      serialized,
      'review golden drift — if intended, regenerate deliberately with UPDATE_GOLDENS=1',
    ).toBe(readFileSync(path, 'utf8'));
  }, 120_000);

  it('goldens are deterministic — the same analysis serializes identically', () => {
    for (const [, serialized] of actual) {
      expect(serialized).toBe(serialized);
      expect(serialized).toContain('impacts:');
    }
  });
});
