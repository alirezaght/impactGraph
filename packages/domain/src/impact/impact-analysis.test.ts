import { describe, expect, it } from 'vitest';

import {
  addUserDecision,
  approveImpactAnalysis,
  computeImpactConfidence,
  createConfidenceScore,
  createImpactAnalysis,
  parseImpactAnalysis,
  serializeImpactAnalysis,
  supersedeImpactAnalysis,
} from '../index.js';

import type { ImpactAnalysis, RequirementImpact } from '../index.js';

const impact: RequirementImpact = {
  requirementId: 'req-1',
  nodeId: 'symbol:src/deals/DealService.ts#DealService',
  likelihood: 'required',
  impactType: 'domain-model',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: "Exact concept match 'DealService'.",
  expectedChanges: ['Review DealService'],
  evidenceIds: ['ev-1'],
  dependencyPath: ['symbol:src/deals/DealService.ts#DealService'],
  provenance: 'static-analysis',
};

const analysis: ImpactAnalysis = {
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-07-31T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [impact],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
};

describe('ImpactAnalysis model (PRD §13, Story 6.5)', () => {
  it('constructs a frozen analysis and rejects taxonomy violations', () => {
    expect(createImpactAnalysis(analysis).ok).toBe(true);
    expect(
      createImpactAnalysis({
        ...analysis,
        requirementImpacts: [{ ...impact, likelihood: 'certain' as never }],
      }).ok,
    ).toBe(false);
    expect(
      createImpactAnalysis({
        ...analysis,
        requirementImpacts: [{ ...impact, impactType: 'ui' as never }],
      }).ok,
    ).toBe(false);
    expect(
      createImpactAnalysis({
        ...analysis,
        requirementImpacts: [{ ...impact, confidenceSignals: [] }],
      }).ok,
    ).toBe(false);
    expect(
      createImpactAnalysis({
        ...analysis,
        requirementImpacts: [{ ...impact, evidenceIds: [] }],
      }).ok,
    ).toBe(false);
  });

  it('approval freezes: no decisions after approval, no re-approval of superseded', () => {
    const created = createImpactAnalysis(analysis);
    if (!created.ok) {
      throw new Error('fixture invalid');
    }
    const approved = approveImpactAnalysis(created.value);
    expect(approved.ok && approved.value.status).toBe('approved');
    if (!approved.ok) {
      return;
    }
    expect(Object.isFrozen(approved.value)).toBe(true);

    const lateDecision = addUserDecision(approved.value, {
      id: 'dec-1',
      requirementId: 'req-1',
      nodeId: impact.nodeId,
      decision: 'rejected',
      decidedAt: '2026-07-31T11:00:00.000Z',
    });
    expect(lateDecision.ok).toBe(false);

    const superseded = supersedeImpactAnalysis(approved.value);
    expect(superseded.ok && superseded.value.status).toBe('superseded');
    if (superseded.ok) {
      expect(approveImpactAnalysis(superseded.value).ok).toBe(false);
    }
    // The original object is untouched — supersession returned a new record.
    expect(approved.value.status).toBe('approved');
  });

  it('decisions append-only on drafts', () => {
    const created = createImpactAnalysis(analysis);
    if (!created.ok) {
      throw new Error('fixture invalid');
    }
    const withDecision = addUserDecision(created.value, {
      id: 'dec-1',
      requirementId: 'req-1',
      nodeId: impact.nodeId,
      decision: 'accepted',
      decidedAt: '2026-07-31T11:00:00.000Z',
    });
    expect(withDecision.ok && withDecision.value.userDecisions).toHaveLength(1);
    expect(created.value.userDecisions).toHaveLength(0);
  });

  it('serialization round-trips exactly', () => {
    const created = createImpactAnalysis(analysis);
    if (!created.ok) {
      throw new Error('fixture invalid');
    }
    const json = serializeImpactAnalysis(created.value);
    expect(json.schemaVersion).toBe(1);
    const parsed = parseImpactAnalysis(JSON.parse(JSON.stringify(json)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(created.value);
    }
    expect(parseImpactAnalysis({ ...json, status: 'final' }).ok).toBe(false);
  });
});

describe('confidence engine weights (PRD §14, Story 6.4)', () => {
  it('is reproducible from signals and stores contributions', () => {
    const result = computeImpactConfidence([
      { type: 'exact-concept-to-symbol-match' },
      { type: 'direct-import' },
      { type: 'graph-distance', description: 'distance 1' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(0.75);
      expect(result.value.signals).toHaveLength(3);
      expect(result.value.signals[2]?.contribution).toBe(-0.25);
    }
  });

  it('applies ambiguity penalties and clamps to (0, 1)', () => {
    const ambiguous = computeImpactConfidence([
      { type: 'exact-concept-to-symbol-match' },
      { type: 'ambiguity' },
    ]);
    expect(ambiguous.ok && ambiguous.value.value).toBe(0.75);

    const floor = computeImpactConfidence([
      { type: 'graph-distance' },
      { type: 'graph-distance' },
      { type: 'graph-distance' },
      { type: 'graph-distance' },
      { type: 'unsupported-inference' },
    ]);
    expect(floor.ok && floor.value.value).toBe(0.05);
  });

  it('penalises a concept that resolved only to a test double', () => {
    const production = computeImpactConfidence([{ type: 'semantic-concept-match' }]);
    const doubleOnly = computeImpactConfidence([
      { type: 'semantic-concept-match' },
      { type: 'test-only-match', description: 'only test artifacts matched' },
    ]);

    expect(production.ok && production.value.value).toBe(0.5);
    expect(doubleOnly.ok && doubleOnly.value.value).toBe(0.25);
  });

  it('rejects a test-only-match signal with a positive contribution', () => {
    expect(createConfidenceScore(0.5, [{ type: 'test-only-match', contribution: 0.2 }]).ok).toBe(
      false,
    );
  });

  it('identical signals always produce identical scores (determinism)', () => {
    const signals = [
      { type: 'semantic-concept-match' as const },
      { type: 'event-relationship' as const },
      { type: 'graph-distance' as const },
    ];
    const a = computeImpactConfidence(signals);
    const b = computeImpactConfidence(signals);
    expect(a.ok && b.ok && a.value.value === b.value.value).toBe(true);
  });
});
