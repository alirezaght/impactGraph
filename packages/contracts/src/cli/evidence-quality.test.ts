import { describe, expect, it } from 'vitest';

import { MCP_SERVER_INSTRUCTIONS } from '../tools/guidance.js';

import {
  cliImpactPageSchema,
  cliImpactSummarySchema,
  evidenceQualitySchema,
  impactEvidenceTypeSchema,
  requiredActionSchema,
} from './impact-summary.js';

// Dogfooding item 4 — the aggregate honesty signal on the analyze summary, the `name-similarity`
// evidence type, and the `report-limited-evidence` action. All additive v1: a v1 reader that
// ignores the new optional fields still validates.

const counts = {
  shownImpactCount: 4,
  strongTierCount: 2,
  strongTierStructuralCount: 0,
  fuzzyAnchorCount: 3,
  multiHopCount: 1,
  tierCappedCount: 2,
};

const evidenceQuality = {
  status: 'weak',
  reasons: ['None of the 2 required/likely impacts rests on structural evidence.'],
  counts,
};

const minimalSummary = {
  schemaVersion: 1,
  command: 'analyze',
  analysis: {
    id: 'a-1',
    snapshotId: 's-1',
    status: 'draft',
    provisional: true,
    provisionalReasons: ['weak evidence'],
  },
  specification: { id: 'sp-1', version: 1, title: 't', extractionMode: 'unchanged' },
  freshness: { state: 'current', stale: false, reasons: [] },
  coverage: {
    requirementCount: 0,
    requirementsWithStructuralImpact: 0,
    indexWarnings: {
      totalCount: 0,
      coverageLosingCount: 0,
      affectsPredictedArea: false,
      groups: [],
    },
  },
  counts: { totalImpacts: 0, componentCount: 0, byLikelihood: {}, byEvidenceType: {} },
  topImpacts: [],
  unmatchedRequirements: [],
  unresolvedConcepts: [],
  blockingQuestions: [],
  nonGoalContradictions: [],
  predictedArtifacts: [],
  warnings: [],
  omittedWarningCount: 0,
  pagination: { returned: 0, totalMatching: 0, appliedFilters: {} },
  impactQuery: { status: 'completed-empty', scope: 'the graph', limitations: [], resultCount: 0 },
  followUp: [],
};

const minimalPage = {
  schemaVersion: 1,
  command: 'impacts',
  analysisId: 'a-1',
  impacts: [],
  pagination: { returned: 0, totalMatching: 0, appliedFilters: {} },
  impactQuery: {
    status: 'completed-empty',
    scope: 'the analysis',
    limitations: [],
    resultCount: 0,
  },
};

describe('evidence-quality contracts (additive v1)', () => {
  it('accepts the three statuses and rejects unknown keys and statuses', () => {
    for (const status of ['evidence-backed', 'mixed', 'weak']) {
      expect(evidenceQualitySchema.safeParse({ ...evidenceQuality, status }).success).toBe(true);
    }
    expect(evidenceQualitySchema.safeParse({ ...evidenceQuality, status: 'great' }).success).toBe(
      false,
    );
    expect(evidenceQualitySchema.safeParse({ ...evidenceQuality, extra: 1 }).success).toBe(false);
    expect(
      evidenceQualitySchema.safeParse({ ...evidenceQuality, counts: { ...counts, extra: 1 } })
        .success,
    ).toBe(false);
  });

  it('the summary accepts the block as optional — with and without', () => {
    expect(cliImpactSummarySchema.safeParse(minimalSummary).success).toBe(true);
    expect(cliImpactSummarySchema.safeParse({ ...minimalSummary, evidenceQuality }).success).toBe(
      true,
    );
  });

  it('name-similarity is a valid evidence type, everywhere the vocabulary appears', () => {
    expect(impactEvidenceTypeSchema.safeParse('name-similarity').success).toBe(true);
  });

  it('report-limited-evidence is a valid required action', () => {
    expect(
      requiredActionSchema.safeParse({
        action: 'report-limited-evidence',
        reason: 'the shown impacts rest on weak evidence',
        instruction: 'Treat this prediction as exploratory and confirm the component names.',
      }).success,
    ).toBe(true);
  });

  it('the impact page accepts the additive counts block — with and without', () => {
    expect(cliImpactPageSchema.safeParse(minimalPage).success).toBe(true);
    expect(
      cliImpactPageSchema.safeParse({
        ...minimalPage,
        counts: {
          totalImpacts: 12,
          componentCount: 9,
          byLikelihood: { required: 2, 'lexical-only': 7 },
          byEvidenceType: { 'name-similarity': 5 },
        },
      }).success,
    ).toBe(true);
  });

  it('the server instructions mention evidence quality', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('evidenceQuality');
  });
});
