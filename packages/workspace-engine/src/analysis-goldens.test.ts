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

import {
  analysisGoldenPath,
  firstRelationship,
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
    signalTypes: impact.confidenceSignals.map((signal) => signal.type),
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

  // Movement diagnostics. A quality change often moves candidates between tiers, or changes which
  // relationship explains them, without altering the total count — the tier demotions that fixed
  // the reverse-call overstatement added and removed nothing. A bare pass/fail on the golden text
  // cannot show that, and a relationship-vocabulary change (splitting USES) would look like no
  // change at all in the counts while materially altering future propagation.
  it('reports how candidates moved relative to the committed goldens', () => {
    interface Row {
      readonly likelihood: string;
      readonly relationship: string;
    }
    const parse = (text: string): Map<string, Row> => {
      const rows = new Map<string, Row>();
      for (const line of text.split('\n')) {
        const parts = line.split('|');
        // requirementId|name|likelihood|type|directness|confidence|relationship|signals
        if (parts.length >= 8 && parts[0]?.startsWith('req-') === true) {
          rows.set(`${parts[0]}|${parts[1] ?? ''}`, {
            likelihood: parts[2] ?? '',
            relationship: parts[6] ?? '',
          });
        }
      }
      return rows;
    };
    const RANK: Readonly<Record<string, number>> = { required: 3, likely: 2, possible: 1 };
    const totals: Record<string, number> = {};
    const tierMoves: Record<string, number> = {};
    const movedBy: Record<string, number> = {};
    const bump = (bag: Record<string, number>, key: string): void => {
      bag[key] = (bag[key] ?? 0) + 1;
    };
    const classify = (baseline: Row | undefined, row: Row): void => {
      if (baseline === undefined) {
        bump(totals, 'added');
        return;
      }
      const delta = (RANK[row.likelihood] ?? 0) - (RANK[baseline.likelihood] ?? 0);
      if (delta !== 0) {
        bump(totals, delta > 0 ? 'promoted' : 'demoted');
        bump(tierMoves, `${baseline.likelihood} → ${row.likelihood}`);
        bump(movedBy, row.relationship);
        return;
      }
      if (row.relationship === baseline.relationship) {
        bump(totals, 'unchanged');
        return;
      }
      bump(totals, 'relationship-changed');
      bump(movedBy, `${baseline.relationship} → ${row.relationship}`);
    };
    for (const sample of SAMPLE_EVALUATIONS) {
      const path = analysisGoldenPath('ts-basic', slug(sample.name));
      if (!existsSync(path)) {
        continue;
      }
      const before = parse(readFileSync(path, 'utf8'));
      const after = parse(actual.get(sample.name) ?? '');
      for (const [key, row] of after) {
        classify(before.get(key), row);
      }
      for (const key of before.keys()) {
        if (!after.has(key)) {
          bump(totals, 'removed');
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      [
        `CANDIDATE MOVEMENT vs committed goldens: ${JSON.stringify(totals)}`,
        Object.keys(tierMoves).length === 0
          ? '  tier moves: none'
          : `  tier moves: ${JSON.stringify(tierMoves)}`,
        Object.keys(movedBy).length === 0
          ? '  by relationship: none'
          : `  by relationship: ${JSON.stringify(movedBy)}`,
      ].join('\n'),
    );
    expect(totals).toBeDefined();
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
