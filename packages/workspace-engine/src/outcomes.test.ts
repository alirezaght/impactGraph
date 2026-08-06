import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { performIndexRun } from './indexing.js';
import { listActualImpacts, recordActualImpact } from './outcomes.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { RecordActualImpactOutcome } from './outcomes.js';

/**
 * Dogfooding item 8: recorded outcomes were write-only in practice — `listActualImpacts` had no
 * caller, so precision across outcomes and ADR-0015's ten-outcome revisit trigger could not be
 * answered. Every recording now carries the aggregate over ALL stored outcomes, derived at answer
 * time from the append-only records. Nothing here feeds back into ranking or confirmed knowledge.
 */

const SPEC = `# Deal expiry

## Requirements

R1: \`DealService\` must hide deals whose expiry date has passed.
`;

describe('recording outcomes aggregates measured accuracy over time (item 8)', () => {
  let repoDir: string;
  let first: RecordActualImpactOutcome;
  let second: RecordActualImpactOutcome;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-outcomes-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'outcomes@test.dev'],
      ['config', 'user.name', 'Outcomes Test'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-m', 'fixture'],
    ]) {
      execFileSync('git', args, { cwd: repoDir });
    }
    initializeWorkspace(repoDir);
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    writeFileSync(join(repoDir, 'spec.md'), SPEC);
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'spec.md',
      rawText: SPEC,
    });
    if (!submitted.ok) {
      throw new Error(submitted.error.message);
    }
    const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    const analysisId = built.value.analysis.id;
    const record = async (
      outcomeId: string,
      recordedAt: string,
      changedFiles: readonly string[],
    ): Promise<RecordActualImpactOutcome> => {
      const recorded = await recordActualImpact({
        rootDir: repoDir,
        analysisId,
        outcomeId,
        recordedAt,
        changedFiles,
      });
      if (!recorded.ok) {
        throw new Error(recorded.error.message);
      }
      return recorded.value;
    };
    first = await record('outcome-one', '2026-08-06T10:00:00.000Z', [
      'src/services/deal-service.ts',
    ]);
    second = await record('outcome-two', '2026-08-06T11:00:00.000Z', [
      'src/services/deal-service.ts',
      'src/api/deals.ts',
    ]);
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('every recording answers with the aggregate over ALL stored outcomes, itself included', () => {
    expect(first.aggregate?.outcomeCount).toBe(1);
    expect(second.aggregate?.outcomeCount).toBe(2);
  });

  it('the aggregate sums the per-outcome tallies and means the ratios that exist', () => {
    const aggregate = second.aggregate;
    expect(aggregate).toBeDefined();
    if (aggregate === undefined) {
      return;
    }
    expect(aggregate.truePositiveCount).toBe(
      first.metrics.truePositives.length + second.metrics.truePositives.length,
    );
    expect(aggregate.falsePositiveCount).toBe(
      first.metrics.falsePositives.length + second.metrics.falsePositives.length,
    );
    expect(aggregate.falseNegativeCount).toBe(
      first.metrics.falseNegatives.length + second.metrics.falseNegatives.length,
    );
    // Both outcomes were judged against real predictions, so both ratios exist and are meaned.
    expect(aggregate.precision).toEqual({
      mean:
        Math.round((((first.metrics.precision ?? 0) + (second.metrics.precision ?? 0)) / 2) * 100) /
        100,
      sampleSize: 2,
    });
    expect(aggregate.recall?.sampleSize).toBe(2);
    // Two outcomes are far from ADR-0015's ten-outcome revisit trigger.
    expect(aggregate.adrTriggerMet).toBe(false);
    expect(aggregate.adrTriggerNote).toBeUndefined();
  });

  it('listActualImpacts is the readable evidence trail: both outcomes, newest first', () => {
    const listed = listActualImpacts(repoDir);
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value.map((record) => record.actual.id)).toEqual(['outcome-two', 'outcome-one']);
  });
});
