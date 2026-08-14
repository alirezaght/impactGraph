import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAnalysis } from './analyses.js';
import { runCoveragePreflight } from './coverage-preflight.js';
import { performIndexRun } from './indexing.js';
import { buildImpactPage } from './reports/impact-page.js';
import { buildImpactSummary } from './reports/impact-summary.js';
import { collectWorkspaceRepositoryContext } from './repository-coverage.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { PreflightOutcome } from './preflight.js';
import type { WorkspaceRepositoryContext } from './repository-coverage.js';
import type { AnalysisBundle } from './specifications.js';
import type { ImpactAnalysis, NodeId, Specification } from '@impactgraph/domain';

/**
 * ADR-0017 §5 end to end: an analysis built from a specification that names a file VERBATIM must
 * persist USER_SUPPLIED on that impact and an independent provenance on what the traversal found —
 * read back from the stored artifact, not from memory, because list_impacts, review and export all
 * read the artifact. Plus: the paginated rows carry the provenance, the summary carries the
 * supplied-identifier resolution, and the unresolved "modify" claim classifies as an invalid
 * assumption.
 */

const SPEC_TEXT = [
  '# Deal filtering',
  '',
  '## Requirements',
  '',
  'R1: `DealService` in `src/services/deal-service.ts` must filter expired deals from search results.',
  'R2: Update `services/legacy_export.py` to keep parity with the filter.',
  '',
].join('\n');

describe('evidence provenance is persisted and reported (ADR-0017 §5)', () => {
  let repoDir: string;
  let specification: Specification;
  let bundle: AnalysisBundle;
  let stored: ImpactAnalysis;
  let workspace: WorkspaceRepositoryContext;
  let preflight: PreflightOutcome;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-provenance-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'provenance@test.dev');
    git('config', 'user.name', 'Provenance');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'deal-filter.md',
      rawText: SPEC_TEXT,
    });
    if (!submitted.ok) {
      throw new Error(submitted.error.message);
    }
    specification = submitted.value.specification;
    const built = await buildAnalysisForSpecification(repoDir, specification);
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    bundle = built.value;
    const loaded = await loadAnalysis(repoDir, bundle.analysis.id);
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    stored = loaded.value;
    const context = await collectWorkspaceRepositoryContext(repoDir);
    if (!context.ok) {
      throw new Error(context.error.message);
    }
    workspace = context.value;
    preflight = await runCoveragePreflight(
      {
        rootDir: repoDir,
        specification,
        specificationText: specification.rawText,
        analysis: stored,
        graph: bundle.graph,
        snapshotId: bundle.snapshotId,
      },
      workspace,
    );
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const pathOf = (analysis: ImpactAnalysis, nodeId: string): string | undefined =>
    bundle.graph.nodes.get(nodeId as NodeId)?.path;

  it('persists USER_SUPPLIED on the file the specification named verbatim', () => {
    const named = stored.requirementImpacts.filter(
      (impact) => pathOf(stored, impact.nodeId) === 'src/services/deal-service.ts',
    );
    expect(named.length).toBeGreaterThan(0);
    for (const impact of named) {
      expect(impact.evidenceProvenance).toBe('USER_SUPPLIED');
    }
  });

  it('persists INDEPENDENTLY_DISCOVERED on an impact the traversal found on its own', () => {
    const discovered = stored.requirementImpacts.filter(
      (impact) => impact.evidenceProvenance === 'INDEPENDENTLY_DISCOVERED',
    );
    expect(discovered.length).toBeGreaterThan(0);
    // and none of the discoveries sit in the file the specification named
    for (const impact of discovered) {
      expect(pathOf(stored, impact.nodeId)).not.toBe('src/services/deal-service.ts');
    }
  });

  it('every persisted impact carries a provenance — nothing is left to the weakest reading', () => {
    for (const impact of stored.requirementImpacts) {
      expect(impact.evidenceProvenance).toBeDefined();
    }
  });

  it('list_impacts page rows carry the provenance and its reader-facing label', () => {
    const page = buildImpactPage({
      specification,
      analysis: stored,
      graph: bundle.graph,
    });
    expect(page.impacts.length).toBeGreaterThan(0);
    for (const row of page.impacts) {
      expect(row.evidenceProvenance).toBeDefined();
      expect(row.provenanceLabel).toBe(
        row.evidenceProvenance === 'USER_SUPPLIED' ? 'confirmation' : 'discovery',
      );
    }
  });

  it('the summary resolves the supplied path-shaped identifiers and lists the miss', () => {
    const summary = buildImpactSummary({
      specification,
      analysis: preflight.analysis,
      graph: bundle.graph,
      freshness: { state: 'current', stale: false, reasons: [] },
      extractionMode: 'unchanged',
      indexWarnings: [],
      workspace,
      preflight,
    });
    expect(summary.suppliedIdentifiers).toEqual({
      pathShapedCount: 2,
      resolvedCount: 1,
      unresolved: ['services/legacy_export.py'],
    });
    expect(summary.planAssessment).toBeDefined();
    expect(summary.evidenceIndependence?.statement).toContain('independently discovered');
    const named = summary.topImpacts.find(
      (impact) => impact.path === 'src/services/deal-service.ts',
    );
    expect(named?.evidenceProvenance).toBe('USER_SUPPLIED');
    expect(named?.provenanceLabel).toBe('confirmation');
  });

  it('classifies the unresolved modification claim as an INVALID_ASSUMPTION', () => {
    const classification = preflight.classifications.find((entry) => entry.requirementId === 'R2');
    expect(classification?.classification).toBe('INVALID_ASSUMPTION');
  });
});
