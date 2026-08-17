import { describe, expect, it } from 'vitest';

import { assessPlan } from './plan-assessment.js';
import { createPreflightFinding } from './preflight-finding.js';

import type { AssessmentInput } from './plan-assessment.js';
import type { PreflightFinding } from './preflight-finding.js';

// Two properties this file exists to hold:
//   1. BLOCKED requires a verified contradiction. "Could not verify" is an investigation.
//   2. The score may never disagree with the verdict. `readiness: 94, feasibility: BLOCKED` was
//      shipped to a user; both numbers were internally defensible and the pair was nonsense.

const finding = (overrides: Partial<PreflightFinding>): PreflightFinding => {
  const result = createPreflightFinding({
    id: 'finding-1',
    kind: 'invalid-assumption',
    severity: 'warning',
    verification: 'unverified-assumption',
    requirementIds: ['R1'],
    statement: 'statement',
    recommendation: 'recommendation',
    subject: {},
    evidenceIds: ['ev-1'],
    confidence: 0.6,
    provenance: 'static-analysis',
    analyzer: 'check-assumptions',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const input = (overrides: Partial<AssessmentInput> = {}): AssessmentInput => ({
  findings: [],
  classifications: [],
  expectedChangeSurfaces: 2,
  blockingQuestions: 0,
  coverageInsufficient: false,
  score: 94,
  ...overrides,
});

describe('what BLOCKED requires', () => {
  it('blocks on a verified contradiction', () => {
    const assessment = assessPlan(
      input({
        findings: [
          finding({
            kind: 'blocking-constraint-violation',
            severity: 'blocking',
            verification: 'verified-contradiction',
          }),
        ],
      }),
    );

    expect(assessment.feasibility).toBe('BLOCKED');
  });

  it('asks for verification — not a block — when an assumption could not be established', () => {
    const assessment = assessPlan(input({ findings: [finding({})] }));

    expect(assessment.feasibility).toBe('NEEDS_VERIFICATION');
    expect(assessment.decision).toContain('could not be verified');
    expect(assessment.decision).not.toContain('Do not implement');
  });

  it('does not let a limitation of the analysis become a verdict about the plan', () => {
    const assessment = assessPlan(
      input({
        findings: [
          finding({
            kind: 'runtime-topology-gap',
            origin: 'analysis-caveat',
            requirementIds: [],
          }),
        ],
      }),
    );

    expect(assessment.feasibility).toBe('READY');
    expect(assessment.counts.analysisCaveats).toBe(1);
  });

  it('keeps a verified contradiction decisive over an unverified one', () => {
    const assessment = assessPlan(
      input({
        findings: [
          finding({ id: 'finding-unverified' }),
          finding({
            id: 'finding-verified',
            kind: 'blocking-constraint-violation',
            severity: 'blocking',
            verification: 'verified-contradiction',
          }),
        ],
      }),
    );

    expect(assessment.feasibility).toBe('BLOCKED');
    expect(assessment.decidingFindingIds).toContain('finding-verified');
  });
});

describe('the score can never contradict the verdict', () => {
  it('caps a high readiness score under a blocking verdict', () => {
    const assessment = assessPlan(
      input({
        score: 94,
        findings: [
          finding({
            kind: 'blocking-constraint-violation',
            severity: 'blocking',
            verification: 'verified-contradiction',
          }),
        ],
      }),
    );

    expect(assessment.feasibility).toBe('BLOCKED');
    expect(assessment.score ?? 100).toBeLessThanOrEqual(20);
    expect(assessment.scoreCappedReason).toContain('BLOCKED');
  });

  it('caps the score under NEEDS_VERIFICATION too, without pretending it is zero', () => {
    const assessment = assessPlan(input({ score: 94, findings: [finding({})] }));

    expect(assessment.score ?? 100).toBeLessThanOrEqual(70);
    expect(assessment.score ?? 0).toBeGreaterThan(20);
  });

  it('leaves an honest score alone when the verdict agrees with it', () => {
    const assessment = assessPlan(input({ score: 94 }));

    expect(assessment.feasibility).toBe('READY');
    expect(assessment.score).toBe(94);
    expect(assessment.scoreCappedReason).toBeUndefined();
  });
});
