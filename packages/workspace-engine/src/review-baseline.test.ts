import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artifactsPath, createImpactAnalysisArtifactStore } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadReviewBaseline } from './analyses.js';
import { initializeWorkspace } from './workspace.js';

import type { AnalysisStatus, ImpactAnalysis } from '@impactgraph/domain';

// Reviewing against an unapproved baseline (PRD §24): the default stays exactly the §40.3
// approval gate; `allowUnapproved` is an EXPLICIT opt-in that never approves anything and
// always rejects superseded records — a retired record is not a prediction.

const analysis = (id: string, status: AnalysisStatus, createdAt: string): ImpactAnalysis => ({
  id,
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: `snap-${id}`,
  createdAt,
  status,
  requirementImpacts: [],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

describe('loadReviewBaseline (draft-baseline review, PRD §24/§40.3)', () => {
  let rootDir: string;

  const save = async (...analyses: readonly ImpactAnalysis[]): Promise<void> => {
    const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
    for (const entry of analyses) {
      const saved = await store.save(entry);
      if (!saved.ok) {
        throw new Error(`fixture ${entry.id}`);
      }
    }
  };

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-baseline-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('default: resolves the approved analysis with approved-contract authority', async () => {
    await save(
      analysis('a-approved', 'approved', '2026-08-01T10:00:00.000Z'),
      analysis('a-draft', 'draft', '2026-08-02T10:00:00.000Z'),
    );
    const baseline = await loadReviewBaseline(rootDir);
    expect(baseline.ok && baseline.value.analysis.id).toBe('a-approved');
    expect(baseline.ok && baseline.value.authority).toBe('approved-contract');
  });

  it('default without approval: refuses as before, and names the draft way forward', async () => {
    await save(
      analysis('a-old-draft', 'draft', '2026-08-01T10:00:00.000Z'),
      analysis('a-new-draft', 'draft', '2026-08-02T10:00:00.000Z'),
    );
    const refused = await loadReviewBaseline(rootDir);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.category).toBe('configurationError');
      expect(refused.error.message).toContain('no approved impact analysis');
      // the hint names the NEWEST draft and the flag — the comparison is still possible
      expect(refused.error.message).toContain('allowUnapprovedBaseline');
      expect(refused.error.message).toContain("'a-new-draft'");
      expect(refused.error.message).toContain('provisional');
    }
  });

  it('default without approval and without any live draft: the old message, no false hint', async () => {
    const refused = await loadReviewBaseline(rootDir);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toBe(
        'no approved impact analysis — run `impactgraph approve <analysisId>` first',
      );
    }
  });

  it('allowUnapproved without id: the most recent non-superseded analysis, marked provisional', async () => {
    await save(
      analysis('a-superseded', 'superseded', '2026-08-03T10:00:00.000Z'),
      analysis('a-reviewed', 'reviewed', '2026-08-02T10:00:00.000Z'),
    );
    const baseline = await loadReviewBaseline(rootDir, { allowUnapproved: true });
    expect(baseline.ok && baseline.value.analysis.id).toBe('a-reviewed');
    expect(baseline.ok && baseline.value.authority).toBe('unapproved-prediction');
  });

  it('allowUnapproved without id still prefers a NEWER approved analysis, as approved-contract', async () => {
    await save(
      analysis('a-draft', 'draft', '2026-08-01T10:00:00.000Z'),
      analysis('a-approved', 'approved', '2026-08-02T10:00:00.000Z'),
    );
    const baseline = await loadReviewBaseline(rootDir, { allowUnapproved: true });
    expect(baseline.ok && baseline.value.analysis.id).toBe('a-approved');
    expect(baseline.ok && baseline.value.authority).toBe('approved-contract');
  });

  it('allowUnapproved with an explicit id: loads exactly that analysis', async () => {
    await save(
      analysis('a-first-draft', 'draft', '2026-08-01T10:00:00.000Z'),
      analysis('a-second-draft', 'draft', '2026-08-02T10:00:00.000Z'),
    );
    const baseline = await loadReviewBaseline(rootDir, {
      allowUnapproved: true,
      analysisId: 'a-first-draft',
    });
    expect(baseline.ok && baseline.value.analysis.id).toBe('a-first-draft');
    expect(baseline.ok && baseline.value.authority).toBe('unapproved-prediction');
  });

  it('always rejects a superseded analysis — a retired record is not a prediction', async () => {
    await save(analysis('a-superseded', 'superseded', '2026-08-01T10:00:00.000Z'));
    const refused = await loadReviewBaseline(rootDir, {
      allowUnapproved: true,
      analysisId: 'a-superseded',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.category).toBe('configurationError');
      expect(refused.error.message).toContain('superseded');
    }
    // and without an id a superseded-only store is "no analysis", never a silent pick
    const empty = await loadReviewBaseline(rootDir, { allowUnapproved: true });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error.message).toContain('no impact analysis has been built yet');
    }
  });

  it('allowUnapproved with an unknown id is a typed not-found error', async () => {
    const refused = await loadReviewBaseline(rootDir, {
      allowUnapproved: true,
      analysisId: 'a-ghost',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toContain('analysis not found: a-ghost');
    }
  });
});
