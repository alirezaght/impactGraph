import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clarificationQuestionKey } from '@impactgraph/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createClarificationArtifactStore } from './clarification-store.js';

import type { ClarificationRecord } from '@impactgraph/domain';

const QUESTION = 'Who owns the deal-updated event?';

const record = (id: string): ClarificationRecord => ({
  id,
  questionKey: clarificationQuestionKey(QUESTION),
  question: QUESTION,
  decision: 'DealService owns it.',
  reason: 'existing publisher lives there',
  specificationId: 'spec-1',
  specificationVersion: 2,
  relatedRequirementIds: ['req-1'],
  relatedNodeIds: [],
  relatedContexts: [],
  decidedAt: '2026-08-01T11:00:00.000Z',
  author: 'user',
  confidence: 1,
  manuallyConfirmed: true,
});

describe('clarification artifact store (Story 15.5, PRD §C9, ADR-0006)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-clar-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a record and lists it back', async () => {
    const store = createClarificationArtifactStore(dir);
    expect((await store.save(record('clar-1'))).ok).toBe(true);
    const listed = await store.listAll();
    expect(listed.ok && listed.value).toEqual([record('clar-1')]);
  });

  it('records are immutable — re-saving the same id is refused, the file survives', async () => {
    const store = createClarificationArtifactStore(dir);
    await store.save(record('clar-1'));
    const again = await store.save(record('clar-1'));
    expect(again.ok).toBe(false);
    expect(readdirSync(join(dir, 'clarifications'))).toEqual(['clar-1.json']);
  });

  it('rejects unsafe ids and reports corrupt artifacts as typed errors', async () => {
    const store = createClarificationArtifactStore(dir);
    expect((await store.save(record('../escape'))).ok).toBe(false);
    await store.save(record('clar-1'));
    writeFileSync(join(dir, 'clarifications', 'bad.json'), '{"schemaVersion":99}', 'utf8');
    const listed = await store.listAll();
    expect(listed.ok).toBe(false);
  });
});
