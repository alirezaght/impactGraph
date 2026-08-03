import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptDeviation } from './deviations.js';
import { buildReviewMarkdown } from './reports/review-markdown.js';
import { applyAcceptedDeviations } from './reports/review-output.js';
import { loadReviewArtifact, saveReviewArtifact } from './review-artifacts.js';

import type { CliReviewOutput, ReviewArtifactDto } from '@impactgraph/contracts';

// Story 11.2 — §24.1 accepted deviations: append-only decisions on a persisted review.
// Findings are never rewritten; a re-run review (new artifact) does not inherit acceptance.

const documentFor = (reviewId: string): CliReviewOutput => ({
  schemaVersion: 1,
  command: 'review',
  reviewId,
  analysis: {
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    approvedSnapshotId: 'snap-1',
  },
  target: 'working-tree',
  reviewSnapshotId: 'snap-2',
  changedFiles: ['src/rogue.ts'],
  findings: [
    {
      category: 'unexpected',
      nodeId: 'sym:rogue',
      nodeName: 'rogue',
      explanation: 'changed but not in the approved analysis',
      filePaths: ['src/rogue.ts'],
    },
    {
      category: 'matched',
      nodeId: 'sym:deal',
      nodeName: 'DealService',
      explanation: 'changed as predicted',
      filePaths: ['src/deal.ts'],
    },
  ],
  coverage: [],
  edgeChanges: { added: [], removed: [] },
  ruleViolations: [],
  discrepanciesFound: true,
});

const artifactFor = (reviewId: string, createdAt: string): ReviewArtifactDto => ({
  schemaVersion: 1,
  id: reviewId,
  createdAt,
  document: documentFor(reviewId),
  acceptedDeviations: [],
});

describe('accepted deviations (Story 11.2, PRD §24.1)', () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-deviation-'));
    const saved = saveReviewArtifact(rootDir, artifactFor('review-1', '2026-08-01T09:00:00.000Z'));
    if (!saved.ok) {
      throw new Error(saved.error.message);
    }
  });

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('appends a decision with the recorded reason; findings stay untouched', () => {
    const accepted = acceptDeviation({
      rootDir,
      reviewId: 'review-1',
      nodeId: 'sym:rogue',
      reason: 'intentional helper extracted during the change',
      actor: 'user',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.decision.category).toBe('unexpected');
    const stored = loadReviewArtifact(rootDir, 'review-1');
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.value.acceptedDeviations).toHaveLength(1);
      // the finding itself is NOT recategorized or rewritten
      expect(stored.value.document.findings[0]?.category).toBe('unexpected');
      expect(stored.value.document).toEqual(documentFor('review-1'));
    }
  });

  it('rejects double acceptance, non-discrepancy findings, and unknown nodes — typed', () => {
    const again = acceptDeviation({
      rootDir,
      reviewId: 'review-1',
      nodeId: 'sym:rogue',
      reason: 'twice',
      actor: 'user',
    });
    expect(!again.ok && again.error.message).toContain('already accepted');
    // 'matched' is not a discrepancy — nothing to accept (§24.1)
    const matched = acceptDeviation({
      rootDir,
      reviewId: 'review-1',
      nodeId: 'sym:deal',
      reason: 'x',
      actor: 'user',
    });
    expect(!matched.ok && matched.error.message).toContain('no discrepancy finding');
    const ghost = acceptDeviation({
      rootDir,
      reviewId: 'review-1',
      nodeId: 'sym:ghost',
      reason: 'x',
      actor: 'user',
    });
    expect(ghost.ok).toBe(false);
  });

  it('the review document is immutable; decisions are append-only', () => {
    const stored = loadReviewArtifact(rootDir, 'review-1');
    if (!stored.ok) {
      throw new Error('fixture missing');
    }
    const tamperedDocument = saveReviewArtifact(rootDir, {
      ...stored.value,
      document: { ...stored.value.document, discrepanciesFound: false },
    });
    expect(!tamperedDocument.ok && tamperedDocument.error.message).toContain('immutable');
    const droppedDecision = saveReviewArtifact(rootDir, {
      ...stored.value,
      acceptedDeviations: [],
    });
    expect(!droppedDecision.ok && droppedDecision.error.message).toContain('append-only');
  });

  it('a re-run review does not inherit acceptance; omitted reviewId targets the latest', () => {
    const rerun = saveReviewArtifact(rootDir, artifactFor('review-2', '2026-08-01T10:00:00.000Z'));
    expect(rerun.ok).toBe(true);
    const latest = loadReviewArtifact(rootDir);
    expect(latest.ok && latest.value.id).toBe('review-2');
    expect(latest.ok && latest.value.acceptedDeviations).toEqual([]);
  });

  it('report rendering marks accepted findings and fills the §38.2 section', () => {
    const stored = loadReviewArtifact(rootDir, 'review-1');
    if (!stored.ok) {
      throw new Error('fixture missing');
    }
    const decorated = applyAcceptedDeviations(
      stored.value.document,
      stored.value.acceptedDeviations,
    );
    expect(decorated.findings[0]?.acceptedDeviation?.reason).toBe(
      'intentional helper extracted during the change',
    );
    expect(decorated.findings[0]?.category).toBe('unexpected'); // never recategorized
    const markdown = buildReviewMarkdown(decorated).join('\n');
    expect(markdown).toContain('## Accepted Deviations');
    expect(markdown).toContain(
      '- **rogue** — accepted (unexpected): intentional helper extracted during the change',
    );
    expect(markdown).toContain('Accepted Deviations: 1');
  });
});
