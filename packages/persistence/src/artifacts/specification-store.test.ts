import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSpecification, stableRequirementId } from '@impactgraph/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSpecificationArtifactStore } from '../index.js';

import type { Specification } from '@impactgraph/domain';

const spec = (version: number): Specification => {
  const statement = 'Expired deals must be hidden from search.';
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: statement,
    version,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    requirements: [
      {
        id: stableRequirementId(statement),
        statement,
        type: 'functional',
        concepts: [],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('fixture invalid');
  }
  return result.value;
};

describe('specification artifact store (Story 5.1, ADR-0006)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-spec-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips versions and lists them in order', async () => {
    const store = createSpecificationArtifactStore(dir);
    expect((await store.saveVersion(spec(1))).ok).toBe(true);
    expect((await store.saveVersion(spec(2))).ok).toBe(true);

    expect(await store.listVersions('spec-1')).toMatchObject({ ok: true, value: [1, 2] });
    const latest = await store.getLatest('spec-1');
    expect(latest.ok && latest.value?.version).toBe(2);
    const v1 = await store.getVersion('spec-1', 1);
    expect(v1.ok && v1.value).toEqual(spec(1));
  });

  it('refuses to overwrite an existing version — artifacts are append-only', async () => {
    const store = createSpecificationArtifactStore(dir);
    await store.saveVersion(spec(1));
    const overwrite = await store.saveVersion(spec(1));
    expect(overwrite.ok).toBe(false);
    if (!overwrite.ok) {
      expect(overwrite.error.code).toBe('validation');
      expect(overwrite.error.message).toContain('immutable');
    }
  });

  it('rejects path-traversal specification ids', async () => {
    const store = createSpecificationArtifactStore(dir);
    const evil = { ...spec(1), id: '../escape' };
    expect((await store.saveVersion(evil as Specification)).ok).toBe(false);
    expect((await store.getVersion('../escape', 1)).ok).toBe(false);
  });

  it('returns undefined for unknown specs and versions', async () => {
    const store = createSpecificationArtifactStore(dir);
    expect(await store.getLatest('ghost')).toMatchObject({ ok: true, value: undefined });
    expect(await store.getVersion('ghost', 3)).toMatchObject({ ok: true, value: undefined });
  });
});
