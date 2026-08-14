import { describe, expect, it } from 'vitest';

import { cliImpactPageSchema, cliImpactSummarySchema } from './impact-summary.js';
import { evidenceIndependenceSchema } from './plan-assessment.js';

// ADR-0017 §5 — the per-impact provenance axis on the wire, the completeness statement, and the
// supplied-identifier resolution block. All additive v1: a payload written before these fields
// existed still validates, and absence never reads as "independently discovered".

const impactLine = {
  nodeId: 'sym:deal',
  name: 'DealService',
  likelihood: 'required',
  evidenceType: 'direct-structural',
  impactType: 'domain-model',
  confidence: 0.9,
  hops: 0,
  requirementIds: ['req-1'],
  requirementLabels: ['R1'],
  reason: 'matched',
};

const summaryWith = (extra: Record<string, unknown>): Record<string, unknown> => ({
  schemaVersion: 1,
  command: 'analyze',
  analysis: {
    id: 'a-1',
    snapshotId: 's-1',
    status: 'draft',
    provisional: false,
    provisionalReasons: [],
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
  ...extra,
});

describe('evidence-provenance contracts (additive v1, ADR-0017 §5)', () => {
  it('a top impact may carry provenance and its label — and may omit both', () => {
    expect(
      cliImpactSummarySchema.safeParse(summaryWith({ topImpacts: [impactLine] })).success,
    ).toBe(true);
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({
          topImpacts: [
            { ...impactLine, evidenceProvenance: 'USER_SUPPLIED', provenanceLabel: 'confirmation' },
          ],
        }),
      ).success,
    ).toBe(true);
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({ topImpacts: [{ ...impactLine, evidenceProvenance: 'TRUST_ME' }] }),
      ).success,
    ).toBe(false);
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({ topImpacts: [{ ...impactLine, provenanceLabel: 'echo' }] }),
      ).success,
    ).toBe(false);
  });

  it('a list_impacts page row inherits the same optional provenance fields', () => {
    const page = {
      schemaVersion: 1,
      command: 'impacts',
      analysisId: 'a-1',
      impacts: [
        {
          ...impactLine,
          evidenceProvenance: 'INDEPENDENTLY_DISCOVERED',
          provenanceLabel: 'discovery',
          dependencyPath: ['sym:deal'],
          evidenceTypes: ['direct-structural'],
          confidenceSignals: [{ type: 'direct-import', contribution: 0.9 }],
        },
      ],
      pagination: { returned: 1, totalMatching: 1, appliedFilters: {} },
      impactQuery: { status: 'completed', scope: 'the analysis', limitations: [], resultCount: 1 },
    };
    expect(cliImpactPageSchema.safeParse(page).success).toBe(true);
  });

  it('evidenceIndependence accepts the completeness statement and stays valid without it', () => {
    const base = {
      independentCount: 4,
      confirmationCount: 5,
      weightedIndependence: 5.2,
      totalCount: 12,
    };
    expect(evidenceIndependenceSchema.safeParse(base).success).toBe(true);
    expect(
      evidenceIndependenceSchema.safeParse({
        ...base,
        statement:
          '4 of 12 impacts were independently discovered; 5 confirm components the specification itself named; 3 rest on weak lexical or transitive matches.',
      }).success,
    ).toBe(true);
  });

  it('the suppliedIdentifiers block is optional, strict, and bounded to 10 unresolved entries', () => {
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({
          suppliedIdentifiers: {
            pathShapedCount: 2,
            resolvedCount: 1,
            unresolved: ['services/x.py'],
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({
          suppliedIdentifiers: {
            pathShapedCount: 20,
            resolvedCount: 0,
            unresolved: Array.from({ length: 11 }, (_, index) => `missing-${String(index)}.py`),
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      cliImpactSummarySchema.safeParse(
        summaryWith({
          suppliedIdentifiers: { pathShapedCount: 0, resolvedCount: 0, unresolved: [], extra: 1 },
        }),
      ).success,
    ).toBe(false);
  });
});
