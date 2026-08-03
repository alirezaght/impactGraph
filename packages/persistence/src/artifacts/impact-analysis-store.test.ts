import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addUserDecision,
  approveImpactAnalysis,
  createImpactAnalysis,
  supersedeImpactAnalysis,
} from '@impactgraph/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createImpactAnalysisArtifactStore } from '../index.js';

import type { ImpactAnalysis } from '@impactgraph/domain';

const draft = (): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-07-31T10:00:00.000Z',
    status: 'draft',
    requirementImpacts: [
      {
        requirementId: 'req-1',
        nodeId: 'sym:policy',
        likelihood: 'required',
        impactType: 'domain-model',
        directness: 'direct',
        confidence: 0.9,
        confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
        explanation: 'Exact match.',
        expectedChanges: [],
        evidenceIds: ['ev-1'],
        dependencyPath: ['sym:policy'],
        provenance: 'static-analysis',
      },
    ],
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });
  if (!result.ok) {
    throw new Error('fixture invalid');
  }
  return result.value;
};

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

describe('impact analysis artifact store (Story 6.5)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-analysis-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips and lists by specification', async () => {
    const store = createImpactAnalysisArtifactStore(dir);
    expect((await store.save(draft())).ok).toBe(true);
    const loaded = await store.get('analysis-1');
    expect(loaded.ok && loaded.value).toEqual(draft());
    const listed = await store.listBySpecification('spec-1');
    expect(listed.ok && listed.value.map((a) => a.id)).toEqual(['analysis-1']);
  });

  it('allows the status lifecycle and decision appends before approval', async () => {
    const store = createImpactAnalysisArtifactStore(dir);
    const analysis = draft();
    await store.save(analysis);

    const withDecision = unwrap(
      addUserDecision(analysis, {
        id: 'dec-1',
        requirementId: 'req-1',
        nodeId: 'sym:policy',
        decision: 'accepted',
        decidedAt: '2026-07-31T11:00:00.000Z',
      }),
      'decision',
    );
    expect((await store.save(withDecision)).ok).toBe(true);

    const approved = unwrap(approveImpactAnalysis(withDecision), 'approve');
    expect((await store.save(approved)).ok).toBe(true);

    const superseded = unwrap(supersedeImpactAnalysis(approved), 'supersede');
    expect((await store.save(superseded)).ok).toBe(true);
  });

  it('rejects content changes — approved analyses are immutable (PRD §40.3)', async () => {
    const store = createImpactAnalysisArtifactStore(dir);
    const approved = unwrap(approveImpactAnalysis(draft()), 'approve');
    await store.save(approved);

    const tampered = { ...approved, createdAt: '2026-08-01T00:00:00.000Z' };
    const contentEdit = await store.save(tampered);
    expect(contentEdit.ok).toBe(false);
    if (!contentEdit.ok) {
      expect(contentEdit.error.message).toContain('immutable');
    }

    const backward = await store.save(draft());
    expect(backward.ok).toBe(false); // approved → draft is not a legal transition
  });

  it('rejects decision removal and post-approval decisions', async () => {
    const store = createImpactAnalysisArtifactStore(dir);
    const analysis = draft();
    const withDecision = unwrap(
      addUserDecision(analysis, {
        id: 'dec-1',
        requirementId: 'req-1',
        nodeId: 'sym:policy',
        decision: 'rejected',
        reason: 'wrong component',
        decidedAt: '2026-07-31T11:00:00.000Z',
      }),
      'decision',
    );
    await store.save(withDecision);

    const removal = await store.save(analysis);
    expect(removal.ok).toBe(false);

    const approved = unwrap(approveImpactAnalysis(withDecision), 'approve');
    await store.save(approved);
    const late = {
      ...approved,
      userDecisions: [...approved.userDecisions, { ...approved.userDecisions[0], id: 'dec-2' }],
    };
    expect((await store.save(late as ImpactAnalysis)).ok).toBe(false);
  });
});
