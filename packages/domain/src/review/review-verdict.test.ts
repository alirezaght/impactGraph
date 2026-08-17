import { describe, expect, it } from 'vitest';

import { reviewVerdict } from './review-verdict.js';

import type { ReviewFinding } from './implementation-review.js';

const finding = (category: ReviewFinding['category'], nodeId: string): ReviewFinding => ({
  category,
  nodeId,
  nodeName: nodeId,
  explanation: `${category} ${nodeId}`,
  filePaths: [nodeId],
});

describe('reviewVerdict', () => {
  it('passes when nothing is missing, unexpected or divergent', () => {
    const verdict = reviewVerdict({
      findings: [finding('matched', 'a'), finding('reuse-confirmed', 'b')],
      ruleViolationCount: 0,
      acceptedNodeIds: [],
    });

    expect(verdict.status).toBe('PASS');
    expect(verdict.counts.matched).toBe(1);
    expect(verdict.counts.reuseConfirmed).toBe(1);
    expect(verdict.headline).toContain('PASS');
    expect(verdict.headline).toContain('reused unchanged by design');
  });

  it('needs attention when a requirement is missing', () => {
    const verdict = reviewVerdict({
      findings: [finding('missing', 'a'), finding('matched', 'b')],
      ruleViolationCount: 0,
      acceptedNodeIds: [],
    });

    expect(verdict.status).toBe('NEEDS_ATTENTION');
    expect(verdict.counts.missing).toBe(1);
    expect(verdict.decidingFindings).toHaveLength(1);
    expect(verdict.decidingFindings[0]?.nodeId).toBe('a');
  });

  it('treats an accepted deviation as answered, not as a failure', () => {
    const verdict = reviewVerdict({
      findings: [finding('unexpected', 'a')],
      ruleViolationCount: 0,
      acceptedNodeIds: ['a'],
    });

    expect(verdict.status).toBe('PASS');
    expect(verdict.counts.acceptedDeviations).toBe(1);
    expect(verdict.counts.unexpected).toBe(1);
  });

  it('needs attention when a configured rule is violated even with no findings', () => {
    const verdict = reviewVerdict({ findings: [], ruleViolationCount: 2, acceptedNodeIds: [] });

    expect(verdict.status).toBe('NEEDS_ATTENTION');
    expect(verdict.counts.ruleViolations).toBe(2);
  });

  it('bounds the deciding findings so the headline stays readable', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      finding('unexpected', `n${String(index)}`),
    );

    const verdict = reviewVerdict({ findings: many, ruleViolationCount: 0, acceptedNodeIds: [] });

    expect(verdict.decidingFindings.length).toBeLessThanOrEqual(5);
    expect(verdict.counts.unexpected).toBe(30);
  });
});
