import { describe, expect, it } from 'vitest';

import { assessPlan } from './plan-assessment.js';
import { createPreflightFinding } from './preflight-finding.js';

import type { AssessmentInput } from './plan-assessment.js';
import type { PreflightFinding } from './preflight-finding.js';

const finding = (overrides: Partial<PreflightFinding> = {}): PreflightFinding => {
  const result = createPreflightFinding({
    id: 'finding-1',
    kind: 'blocking-constraint-violation',
    severity: 'blocking',
    requirementIds: ['R6'],
    statement:
      'Requirement R6 introduces peer-service HTTP from newsletter-service to user-profile-service, which check-service-peer-http.py prohibits.',
    recommendation: 'Route the call through the allowlisted send job, or revise the design.',
    subject: { constraintId: 'constraint-peer-http' },
    evidenceIds: ['ev-1'],
    confidence: 0.95,
    provenance: 'static-analysis',
    analyzer: 'check-constraints',
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
  expectedChangeSurfaces: 12,
  blockingQuestions: 0,
  coverageInsufficient: false,
  score: 87,
  ...overrides,
});

describe('assessPlan', () => {
  it('reports BLOCKED for a hard invariant violation even when coverage is excellent', () => {
    const assessment = assessPlan(input({ findings: [finding()], expectedChangeSurfaces: 40 }));
    expect(assessment.feasibility).toBe('BLOCKED');
    expect(assessment.counts.blockingViolations).toBe(1);
    expect(assessment.decision).toContain('Do not implement yet');
    expect(assessment.decidingFindingIds).toEqual(['finding-1']);
  });

  it('lets a violation outrank insufficient coverage', () => {
    const assessment = assessPlan(input({ findings: [finding()], coverageInsufficient: true }));
    expect(assessment.feasibility).toBe('BLOCKED');
  });

  it('withholds the score when coverage is insufficient', () => {
    const assessment = assessPlan(input({ coverageInsufficient: true }));
    expect(assessment.feasibility).toBe('INSUFFICIENT_COVERAGE');
    expect(assessment.score).toBeUndefined();
    expect(assessment.scoreWithheldReason).toContain('insufficient');
  });

  it('reports NEEDS_CLARIFICATION when an architectural question is open', () => {
    const assessment = assessPlan(input({ blockingQuestions: 2 }));
    expect(assessment.feasibility).toBe('NEEDS_CLARIFICATION');
    expect(assessment.decision).toContain('2 open architectural question');
  });

  it('reports READY_WITH_WARNINGS for a non-blocking runtime gap', () => {
    const gap = finding({
      id: 'finding-2',
      kind: 'runtime-topology-gap',
      severity: 'warning',
      statement: 'admin traffic reaches newsletter-service through an aggregator lacking the config',
    });
    const assessment = assessPlan(input({ findings: [gap] }));
    expect(assessment.feasibility).toBe('READY_WITH_WARNINGS');
    expect(assessment.counts.runtimeTopologyGaps).toBe(1);
    expect(assessment.decidingFindingIds).toEqual(['finding-2']);
  });

  it('does not treat new surface as a warning', () => {
    const surface = finding({
      id: 'finding-3',
      kind: 'new-surface',
      severity: 'informational',
      statement: 'R9 creates a localization namespace that does not exist',
    });
    const assessment = assessPlan(input({ findings: [surface] }));
    expect(assessment.feasibility).toBe('READY');
    expect(assessment.counts.newSurfaces).toBe(1);
    expect(assessment.decision).toContain('new surface');
  });

  it('keeps the score as a secondary field, never the decision', () => {
    const assessment = assessPlan(input());
    expect(assessment.score).toBe(87);
    expect(assessment.decision).not.toContain('87');
  });
});

describe('createPreflightFinding', () => {
  it('refuses to let a planning fact be blocking', () => {
    const result = createPreflightFinding({
      ...finding(),
      kind: 'new-surface',
      severity: 'blocking',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]?.message).toContain('planning fact');
    }
  });

  it('refuses a blocking finding with no evidence', () => {
    const result = createPreflightFinding({ ...finding(), evidenceIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]?.message).toContain('requires evidence');
    }
  });
});
