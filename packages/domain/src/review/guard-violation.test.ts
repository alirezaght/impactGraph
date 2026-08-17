import { describe, expect, it } from 'vitest';

import { hasDiscrepancies, REVIEW_CATEGORIES } from './implementation-review.js';
import { reviewVerdict } from './review-verdict.js';

import type { ImplementationReview, ReviewFinding } from './implementation-review.js';

// A regression boundary is the strongest thing a specification can say about a surface: "do not
// change this". Reporting its violation as a generic `divergent` would put it behind the same
// wording as "changed differently than planned", which is a much weaker claim.

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  category: 'guard-violated',
  nodeId: 'file:src/send-job.ts',
  nodeName: 'send-job.ts',
  requirementId: 'req-1',
  explanation: 'The specification protects this surface, but it was modified.',
  filePaths: ['src/send-job.ts'],
  ...overrides,
});

describe('guard-violated review category', () => {
  it('is part of the review vocabulary, ranked with the other discrepancies', () => {
    expect(REVIEW_CATEGORIES).toContain('guard-violated');
  });

  it('counts as a discrepancy for the CLI exit code', () => {
    const review = { findings: [finding()] } as unknown as ImplementationReview;
    expect(hasDiscrepancies(review)).toBe(true);
  });
});

describe('reviewVerdict — regression boundaries', () => {
  it('counts guard violations and fails the verdict on them alone', () => {
    const verdict = reviewVerdict({
      findings: [finding()],
      ruleViolationCount: 0,
      acceptedNodeIds: [],
    });
    expect(verdict.counts.guardViolated).toBe(1);
    expect(verdict.status).toBe('NEEDS_ATTENTION');
    expect(verdict.headline).toContain('regression boundary');
  });

  it('ranks a guard violation at least as high as a divergent surface', () => {
    const verdict = reviewVerdict({
      findings: [
        finding({ category: 'unexpected', nodeId: 'file:a.ts' }),
        finding({ category: 'divergent', nodeId: 'file:b.ts' }),
        finding({ nodeId: 'file:c.ts' }),
      ],
      ruleViolationCount: 0,
      acceptedNodeIds: [],
    });
    const categories = verdict.decidingFindings.map((entry) => entry.category);
    expect(categories.indexOf('guard-violated')).toBeLessThan(categories.indexOf('divergent'));
    expect(categories.indexOf('guard-violated')).toBeLessThan(categories.indexOf('unexpected'));
  });

  it('passes when a protected surface was left alone', () => {
    const verdict = reviewVerdict({
      findings: [
        finding({
          category: 'reuse-confirmed',
          explanation: 'Regression boundary held: send-job.ts is unchanged.',
        }),
      ],
      ruleViolationCount: 0,
      acceptedNodeIds: [],
    });
    expect(verdict.status).toBe('PASS');
    expect(verdict.counts.guardViolated).toBe(0);
  });
});
