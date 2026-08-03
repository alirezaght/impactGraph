import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artifactsPath, createImpactAnalysisArtifactStore } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { approveAnalysis } from './decisions.js';
import { initializeWorkspace } from './workspace.js';

import type { ImpactAnalysis } from '@impactgraph/domain';

// §40.3: exactly ONE analysis may be approved per specification version. "The approved analysis"
// IS the review baseline, so two of them means `loadApprovedAnalysis` silently decides which
// predictions an implementation is judged against.
//
// This escaped every existing test because they each approve ONE analysis in a fresh workspace.
// The defect only appears on the SECOND approval — which is the normal case the moment scoring
// changes and a specification is re-analyzed. Found by re-approving on a real repository.

const analysis = (id: string, version = 1): ImpactAnalysis => ({
  id,
  specificationId: 'spec-1',
  specificationVersion: version,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-03T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

describe('approval supersedes the previous baseline (§40.3)', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-approve-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
    for (const id of ['analysis-old', 'analysis-new', 'analysis-other-version']) {
      const saved = await store.save(
        id === 'analysis-other-version' ? analysis(id, 2) : analysis(id),
      );
      if (!saved.ok) {
        throw new Error(`fixture ${id}`);
      }
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  const statuses = async (): Promise<Record<string, string>> => {
    const listed = await createImpactAnalysisArtifactStore(artifactsPath(rootDir)).listAll();
    if (!listed.ok) {
      throw new Error('listAll failed');
    }
    return Object.fromEntries(listed.value.map((entry) => [entry.id, entry.status]));
  };

  it('leaves exactly ONE approved analysis per specification version', async () => {
    expect((await approveAnalysis(rootDir, 'analysis-old')).ok).toBe(true);
    expect((await approveAnalysis(rootDir, 'analysis-new')).ok).toBe(true);

    const byId = await statuses();
    expect(byId['analysis-new']).toBe('approved');
    expect(byId['analysis-old']).toBe('superseded');
    expect(Object.values(byId).filter((status) => status === 'approved')).toHaveLength(1);
  });

  it('supersedes rather than deletes — the old record survives with its history (§3)', async () => {
    await approveAnalysis(rootDir, 'analysis-old');
    await approveAnalysis(rootDir, 'analysis-new');

    const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
    const old = await store.get('analysis-old');
    expect(old.ok && old.value).toBeDefined();
    if (old.ok && old.value !== undefined) {
      expect(old.value.status).toBe('superseded');
      expect(old.value.specificationId).toBe('spec-1');
    }
  });

  it('does NOT touch an approved analysis of a different specification version', async () => {
    expect((await approveAnalysis(rootDir, 'analysis-other-version')).ok).toBe(true);
    expect((await approveAnalysis(rootDir, 'analysis-new')).ok).toBe(true);

    const byId = await statuses();
    // Different versions are different baselines; superseding across them would silently discard
    // the baseline for a version still under review.
    expect(byId['analysis-other-version']).toBe('approved');
    expect(byId['analysis-new']).toBe('approved');
  });

  it('re-approving the already-approved analysis is refused, not silently re-run', async () => {
    await approveAnalysis(rootDir, 'analysis-new');
    const again = await approveAnalysis(rootDir, 'analysis-new');
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.message).toContain('approved');
    }
    expect((await statuses())['analysis-new']).toBe('approved');
  });
});
