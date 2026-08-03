import { describe, expect, it } from 'vitest';

import { cliAnalyzeOutputSchema, MCP_TOOL_CONTRACTS, proposedStructureSchema } from '../index.js';

// §18.4 proposed structure on the analyze document. The contract's job here is to make the
// current/proposed distinction impossible to lose: a separate field, a literal `status`, and an
// explicit endpoint kind — so a consumer can DIFF the two halves instead of merging them.

const relationship = {
  id: 'proposed-rel-1a2b3c4d',
  sourceId: 'svc:expiry',
  targetId: 'topic:deal-expired',
  sourceKind: 'existing',
  targetKind: 'existing',
  type: 'PUBLISHES',
  status: 'proposed',
  originOptionId: 'option-9f8e7d6c',
  rationale:
    "Option 'Publish expiry events' affects both components; the graph does not relate them.",
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1', 'ev-2'],
  confidence: 0.4,
  confidenceSignals: [
    { type: 'framework-convention', contribution: 0.45, description: 'the target type fixes it' },
    { type: 'unsupported-inference', contribution: -0.25 },
  ],
};

const proposedNode = {
  id: 'proposed:visibility-projection',
  name: 'VisibilityProjection',
  category: 'data',
  type: 'table',
  originOptionId: 'option-9f8e7d6c',
  rationale: 'the option would materialise a projection',
  provenance: 'human-confirmed',
  evidenceIds: [],
  confidence: 1,
  confidenceSignals: [{ type: 'human-confirmed-mapping', contribution: 0.9 }],
};

const baseAnalyze = {
  schemaVersion: 1 as const,
  command: 'analyze' as const,
  specification: {
    id: 'spec-1',
    version: 1,
    title: 'Deal visibility',
    extractionMode: 'provider' as const,
  },
  analysis: { id: 'analysis-1', snapshotId: 'snap-1', status: 'draft', impactCount: 2 },
  requirements: [],
  warnings: [],
};

describe('proposed structure contract (PRD §18.4)', () => {
  it('accepts a relationship between two existing graph nodes', () => {
    const parsed = proposedStructureSchema.safeParse({ nodes: [], relationships: [relationship] });
    expect(parsed.success).toBe(true);
  });

  it('accepts a proposed node alongside a relationship that points at it', () => {
    const parsed = proposedStructureSchema.safeParse({
      nodes: [proposedNode],
      relationships: [
        { ...relationship, targetId: proposedNode.id, targetKind: 'proposed' as const },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses any status other than 'proposed' — the field cannot describe current structure", () => {
    for (const status of ['current', 'existing', 'approved']) {
      expect(
        proposedStructureSchema.safeParse({
          nodes: [],
          relationships: [{ ...relationship, status }],
        }).success,
      ).toBe(false);
    }
  });

  it('refuses an unknown endpoint kind — an endpoint is either in the graph or proposed', () => {
    expect(
      proposedStructureSchema.safeParse({
        nodes: [],
        relationships: [{ ...relationship, targetKind: 'maybe' }],
      }).success,
    ).toBe(false);
  });

  it('refuses a bare model number: provenance, evidence and signals are required fields', () => {
    for (const key of ['provenance', 'evidenceIds', 'confidenceSignals', 'originOptionId']) {
      const partial: Record<string, unknown> = { ...relationship };
      delete partial[key];
      expect(
        proposedStructureSchema.safeParse({ nodes: [], relationships: [partial] }).success,
      ).toBe(false);
    }
  });

  it('refuses unknown keys and out-of-range confidence', () => {
    expect(
      proposedStructureSchema.safeParse({
        nodes: [],
        relationships: [{ ...relationship, weight: 3 }],
      }).success,
    ).toBe(false);
    expect(
      proposedStructureSchema.safeParse({
        nodes: [],
        relationships: [{ ...relationship, confidence: 1.4 }],
      }).success,
    ).toBe(false);
  });

  it('round-trips through JSON unchanged', () => {
    const document = {
      ...baseAnalyze,
      proposedStructure: { nodes: [proposedNode], relationships: [relationship] },
    };
    const parsed = cliAnalyzeOutputSchema.parse(document);
    expect(cliAnalyzeOutputSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('is additive: a prior-shape analyze document without the field still parses', () => {
    const parsed = cliAnalyzeOutputSchema.safeParse(baseAnalyze);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.proposedStructure).toBeUndefined();
  });

  it('keeps proposed structure out of the impact list — the two are different shapes', () => {
    const smuggled = {
      ...baseAnalyze,
      requirements: [
        {
          id: 'req-1',
          statement: 'Expired deals must disappear.',
          impacts: [
            {
              nodeId: 'svc:expiry',
              name: 'DealExpiryService',
              likelihood: 'required',
              impactType: 'event-contract',
              directness: 'direct',
              confidence: 0.8,
              dependencyPath: ['svc:expiry'],
              evidenceFiles: ['src/expiry.ts'],
              status: 'proposed',
            },
          ],
          openQuestions: [],
        },
      ],
    };
    expect(cliAnalyzeOutputSchema.safeParse(smuggled).success).toBe(false);
  });

  it('reaches agents too: the analyze_impact MCP tool speaks the same document', () => {
    const parsed = MCP_TOOL_CONTRACTS.analyze_impact.output.safeParse({
      ...baseAnalyze,
      proposedStructure: { nodes: [], relationships: [relationship] },
    });
    expect(parsed.success).toBe(true);
  });
});
