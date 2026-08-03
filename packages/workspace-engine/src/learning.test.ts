import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyConfigOperation } from './config-operations.js';
import {
  appendLearningProposal,
  coChangeStats,
  historicalCoChangeProposal,
  listLearningProposals,
  reviewCoChangeProposal,
} from './learning.js';
import { initializeWorkspace } from './workspace.js';

import type { ArchitectureRule } from '@impactgraph/application';

// §Z9/§Z16 — deterministic learning: review co-change → rule proposal; proposals are queued,
// applying one goes through the governed operation path.

const EXISTING_RULE: ArchitectureRule = {
  id: 'schema-needs-migration',
  type: 'accompanying-change',
  whenChanged: 'prisma/schema.prisma',
  requireChanged: 'prisma/migrations/**',
};

const SCHEMA_COMMIT = ['prisma/schema.prisma', 'prisma/migrations/1/migration.sql'];
const SCHEMA_ONLY = ['prisma/schema.prisma', 'src/a.ts'];

describe('historical co-change mining (§C7)', () => {
  it('counts trigger and together commits deterministically', () => {
    const stats = coChangeStats(
      [SCHEMA_COMMIT, SCHEMA_ONLY, SCHEMA_COMMIT, ['src/b.ts']],
      /schema\.prisma$/,
      /migrations\//,
    );
    expect(stats).toEqual({ triggerCommits: 3, togetherCommits: 2 });
  });

  it('proposes the rule with history-citing evidence when the pattern holds (≥3, ≥80%)', () => {
    const proposal = historicalCoChangeProposal(
      [SCHEMA_COMMIT, SCHEMA_COMMIT, SCHEMA_COMMIT, SCHEMA_COMMIT, ['src/x.ts']],
      [],
    );
    expect(proposal).toBeDefined();
    // §C7: the reason cites actual repository history, not a generic ask
    expect(proposal?.reason).toContain('4 of the last 4 commits');
    expect(proposal?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('stays silent below the evidence threshold or when a rule already covers it', () => {
    expect(historicalCoChangeProposal([SCHEMA_COMMIT, SCHEMA_COMMIT], [])).toBeUndefined();
    expect(
      historicalCoChangeProposal(
        [SCHEMA_COMMIT, SCHEMA_ONLY, SCHEMA_ONLY, SCHEMA_ONLY, SCHEMA_ONLY],
        [],
      ),
    ).toBeUndefined();
    expect(
      historicalCoChangeProposal(
        [SCHEMA_COMMIT, SCHEMA_COMMIT, SCHEMA_COMMIT, SCHEMA_COMMIT],
        [EXISTING_RULE],
      ),
    ).toBeUndefined();
  });
});

describe('learning loop (Stories 14.7/§Z9)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-learn-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error('init failed');
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('schema + migration changing together proposes the accompanying-change rule (§Z9)', () => {
    const proposal = reviewCoChangeProposal(
      ['prisma/schema.prisma', 'prisma/migrations/20260801/migration.sql', 'src/a.ts'],
      [],
    );
    expect(proposal).toMatchObject({
      kind: 'add-rule',
      rule: { type: 'accompanying-change', whenChanged: 'prisma/schema.prisma' },
      confidence: 0.7,
    });
  });

  it('no proposal when the rule already exists or the co-change was not observed', () => {
    expect(
      reviewCoChangeProposal(
        ['prisma/schema.prisma', 'prisma/migrations/x/migration.sql'],
        [EXISTING_RULE],
      ),
    ).toBeUndefined();
    expect(reviewCoChangeProposal(['prisma/schema.prisma', 'src/a.ts'], [])).toBeUndefined();
  });

  it('proposals queue append-only and the suggested operation applies through the governed path', () => {
    const proposal = reviewCoChangeProposal(
      ['prisma/schema.prisma', 'prisma/migrations/20260801/migration.sql'],
      [],
    );
    if (proposal === undefined) {
      throw new Error('expected a proposal');
    }
    const appended = appendLearningProposal(rootDir, {
      schemaVersion: 1,
      timestamp: '2026-08-01T10:00:00.000Z',
      kind: 'review-co-change',
      detail: proposal.reason,
      suggestedOperation: proposal,
    });
    expect(appended.ok).toBe(true);
    const listed = listLearningProposals(rootDir);
    expect(listed.ok && listed.value).toHaveLength(1);

    // applying the learned rule is a normal material operation — audited, validated
    const applied = applyConfigOperation({
      rootDir,
      operation: proposal,
      actor: { kind: 'user' },
    });
    expect(applied.ok && applied.value.file).toBe('rules.yml');
    // a second application is a duplicate and is rejected (§Z13)
    const duplicate = applyConfigOperation({
      rootDir,
      operation: proposal,
      actor: { kind: 'user' },
    });
    expect(duplicate.ok).toBe(false);
  });
});
