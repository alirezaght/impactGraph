import { anAnalysis, anImpact } from '@impactgraph/test-kit';
import { createImplementationReview } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { applyAcceptedDeviations, buildReviewOutput, pageReviewFindings } from './review-output.js';

import type { ImplementationReview, ReviewFinding } from '@impactgraph/domain';

// ADR-0022: one review returned ~170 KB and 137 findings, and the answer it contained — zero
// violations — was reachable only with jq. The wire document is bounded and verdict-first; the
// persisted artifact keeps every finding, and get_review_report pages them.

const finding = (category: ReviewFinding['category'], nodeId: string): ReviewFinding => ({
  category,
  nodeId,
  nodeName: nodeId,
  explanation: `${category}: ${nodeId}`,
  filePaths: [nodeId],
});

const review = (findings: readonly ReviewFinding[]): ImplementationReview => {
  const result = createImplementationReview({
    id: 'review-1',
    analysisId: 'analysis-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    createdAt: '2026-08-17T10:00:00.000Z',
    changedFiles: findings.flatMap((entry) => [...entry.filePaths]),
    findings: [...findings],
    coverage: [],
    edgeChanges: { added: [], removed: [] },
  });
  if (!result.ok) {
    throw new Error('fixture review invalid');
  }
  return result.value;
};

const analysis = () => anAnalysis([anImpact({ nodeId: 'file:src/a.ts' })]);

const manyUnexpected = (count: number): ReviewFinding[] =>
  Array.from({ length: count }, (_, index) => finding('unexpected', `file:src/gen/m${String(index)}.ts`));

describe('buildReviewOutput (ADR-0022)', () => {
  it('leads with the verdict', () => {
    const document = buildReviewOutput(review([finding('matched', 'file:src/a.ts')]), analysis(), []);

    expect(Object.keys(document)[0]).toBe('verdict');
    expect(document.verdict?.status).toBe('PASS');
    expect(document.discrepanciesFound).toBe(false);
  });

  it('caps the wire findings per category and counts what it withheld', () => {
    const document = buildReviewOutput(review(manyUnexpected(137)), analysis(), []);

    expect(document.findings.length).toBeLessThanOrEqual(12);
    expect(document.verdict?.truncatedFindingCounts?.['unexpected']).toBe(125);
    expect(document.verdict?.counts.unexpected).toBe(137);
  });

  it('keeps every finding when the caller stores the document', () => {
    const document = buildReviewOutput(review(manyUnexpected(137)), analysis(), [], {
      boundFindings: false,
    });

    expect(document.findings).toHaveLength(137);
  });

  it('does not let a noisy category evict a decisive one', () => {
    const document = buildReviewOutput(
      review([...manyUnexpected(50), finding('missing', 'file:src/policy.ts')]),
      analysis(),
      [],
    );

    expect(document.findings.some((entry) => entry.category === 'missing')).toBe(true);
    expect(document.verdict?.decidingFindings.some((entry) => entry.category === 'missing')).toBe(
      true,
    );
  });
});

describe('accepted deviations and paging', () => {
  const stored = buildReviewOutput(
    review([finding('unexpected', 'file:src/surprise.ts')]),
    analysis(),
    [],
    { boundFindings: false },
  );

  it('an accepted deviation settles the verdict instead of leaving it failing', () => {
    expect(stored.verdict?.status).toBe('NEEDS_ATTENTION');

    const answered = applyAcceptedDeviations(stored, [
      {
        nodeId: 'file:src/surprise.ts',
        category: 'unexpected',
        reason: 'generated output, reviewed separately',
        actor: 'agent',
        decidedAt: '2026-08-17T11:00:00.000Z',
      },
    ]);

    expect(answered.verdict?.status).toBe('PASS');
    expect(answered.discrepanciesFound).toBe(false);
    expect(answered.findings[0]?.acceptedDeviation?.reason).toContain('generated output');
  });

  it('pages the stored findings a bounded response omitted', () => {
    const full = buildReviewOutput(review(manyUnexpected(30)), analysis(), [], {
      boundFindings: false,
    });

    const page = pageReviewFindings(full, { category: 'unexpected', topN: 10, offset: 20 });

    expect(page.findings).toHaveLength(10);
    expect(page.findings[0]?.nodeId).toBe('file:src/gen/m20.ts');
  });
});
