import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveAnalysis } from './decisions.js';
import { performIndexRun } from './indexing.js';
import { runReviewPipeline } from './review.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { ReviewBundle } from './review.js';

// Item 7 (PRD §C15.3) — the review pipeline classifies its edge changes against the CONFIGURED
// bounded contexts: a change that wires the api context into the services context must arrive
// as a named `cross-context` drift entry, not as a bare edge-id string.

const ARCHITECTURE_YML = `schemaVersion: 1
contexts:
  - name: api
    paths:
      - "src/api/**"
  - name: services
    paths:
      - "src/services/**"
  - name: lib
    paths:
      - "src/lib/**"
`;

/** A change in the api context that imports straight into the services context. */
const CROSS_CONTEXT_CHANGE = `
import { buildDealService } from '../services/deal-service';

export function getVisibleDeals(): string[] {
  return buildDealService().searchDeals('');
}
`;

describe('review pipeline drift block on ts-basic with configured contexts (item 7)', () => {
  let repoDir: string;
  let bundle: ReviewBundle;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-drift-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'drift@test.dev');
    git('config', 'user.name', 'Drift Test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    writeFileSync(join(repoDir, '.impactgraph', 'architecture.yml'), ARCHITECTURE_YML);
    git('add', '.');
    git('commit', '-m', 'init impactgraph with contexts');
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'deal-visibility.md',
      rawText: '# Deal filtering\nDealService must filter expired deals from search results.\n',
    });
    if (!submitted.ok) {
      throw new Error(submitted.error.message);
    }
    const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    const approved = await approveAnalysis(repoDir, built.value.analysis.id);
    if (!approved.ok) {
      throw new Error(approved.error.message);
    }
    appendFileSync(join(repoDir, 'src/api/deals.ts'), CROSS_CONTEXT_CHANGE);
    const reviewed = await runReviewPipeline(repoDir, 'working-tree');
    if (!reviewed.ok) {
      throw new Error(reviewed.error.message);
    }
    bundle = reviewed.value;
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('produces a drift block with a named cross-context entry for the new api→services edge', () => {
    const drift = bundle.breakdownContext.drift;
    expect(drift).toBeDefined();
    const crossContext = (drift?.entries ?? []).filter(
      (entry) => entry.category === 'cross-context',
    );
    expect(crossContext.length).toBeGreaterThan(0);
    const contexts = crossContext.map((entry) => [entry.from.context, entry.to.context]);
    expect(contexts).toContainEqual(['api', 'services']);
    for (const entry of crossContext) {
      expect(entry.from.nodeName.length).toBeGreaterThan(0);
      expect(entry.to.nodeName.length).toBeGreaterThan(0);
      expect(entry.direction).toBe('added');
    }
  });

  it('assesses unmapped-context touches because contexts are configured', () => {
    // Presence is the claim: with contexts configured the block must be assessed, never
    // omitted. Whether `api` lands in it depends on what the approved analysis predicted,
    // which is the analysis engine's business, not this pipeline's.
    expect(bundle.breakdownContext.drift?.unmappedContexts).toBeDefined();
  });

  it('keeps drift out of the §24.1 finding vocabulary', () => {
    const categories = new Set(bundle.review.findings.map((finding) => finding.category));
    for (const category of categories) {
      expect([
        'matched',
        'missing',
        'unexpected',
        'divergent',
        'unverifiable',
        'accepted-deviation',
      ]).toContain(category);
    }
  });
});
