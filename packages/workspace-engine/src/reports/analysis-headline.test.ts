import { describe, expect, it } from 'vitest';

import { buildHeadline, strongSurfaceCount } from './analysis-headline.js';

import type { PlanAssessmentDto } from '@impactgraph/contracts';

const assessment = (
  feasibility: PlanAssessmentDto['feasibility'],
  counts: Partial<PlanAssessmentDto['counts']> = {},
): PlanAssessmentDto => ({
  feasibility,
  decision: 'decision text',
  counts: {
    blockingViolations: 0,
    invalidAssumptions: 0,
    runtimeTopologyGaps: 0,
    configSemanticsRisks: 0,
    newSurfaces: 0,
    coverageGaps: 0,
    unresolvedArchitecturalQuestions: 0,
    constraintWarnings: 0,
    missingConsumers: 0,
    typeSensitiveComparisons: 0,
    expectedChangeSurfaces: 0,
    ...counts,
  },
  decidingFindingIds: [],
});

describe('buildHeadline (ADR-0022)', () => {
  it('states the verdict, the risks, the strong surfaces and their independence', () => {
    const headline = buildHeadline({
      assessment: assessment('READY_WITH_WARNINGS', {
        invalidAssumptions: 1,
        constraintWarnings: 1,
      }),
      independence: {
        independentCount: 11,
        confirmationCount: 3,
        weightedIndependence: 11,
        totalCount: 14,
        statement: 'irrelevant here',
      },
      strongSurfaceCount: 14,
      unmatchedRequirementCount: 0,
      unresolvedConceptCount: 0,
    });

    expect(headline).toContain('READY WITH RISKS — 2 risks to verify');
    expect(headline).toContain('14 change surfaces on strong evidence');
    expect(headline).toContain('3 supplied by the specification, 11 independently corroborated');
    expect(headline).toContain('no known coverage gaps');
  });

  it('names the coverage gaps when there are any', () => {
    const headline = buildHeadline({
      assessment: assessment('READY'),
      strongSurfaceCount: 2,
      unmatchedRequirementCount: 3,
      unresolvedConceptCount: 1,
    });

    expect(headline).toContain('3 requirements matched nothing');
    expect(headline).toContain('1 named component did not resolve');
  });

  it('leads with BLOCKED when the plan is blocked', () => {
    const headline = buildHeadline({
      assessment: assessment('BLOCKED', { blockingViolations: 1 }),
      strongSurfaceCount: 0,
      unmatchedRequirementCount: 0,
      unresolvedConceptCount: 0,
    });

    expect(headline?.startsWith('BLOCKED — 1 risk to verify')).toBe(true);
  });

  it('says nothing when no assessment was computed', () => {
    expect(
      buildHeadline({
        strongSurfaceCount: 1,
        unmatchedRequirementCount: 0,
        unresolvedConceptCount: 0,
      }),
    ).toBeUndefined();
  });
});

describe('strongSurfaceCount', () => {
  it('counts only strong-tier structural surfaces, never name matches', () => {
    const count = strongSurfaceCount([
      { likelihood: 'required', evidenceType: 'direct-structural' },
      { likelihood: 'likely', evidenceType: 'transitive-structural' },
      { likelihood: 'likely', evidenceType: 'name-similarity' },
      { likelihood: 'possible', evidenceType: 'direct-structural' },
      { likelihood: 'required', evidenceType: 'lexical-only' },
    ] as unknown as Parameters<typeof strongSurfaceCount>[0]);

    expect(count).toBe(2);
  });
});
