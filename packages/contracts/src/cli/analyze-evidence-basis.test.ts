import { describe, expect, it } from 'vitest';

import { impactGraphNodeSchema } from '../webview/panels.js';

import { impactEvidenceTypeSchema } from './impact-summary.js';
import { cliAnalyzeOutputSchema } from './outputs.js';

// Dogfooding item 4, final slice — the FULL analyze document (the `--full` CLI surface and the
// VS Code webview's input) carries the evidence basis and the tier cap per impact, additively:
// a v1 reader that ignores the new optional fields still validates.

const impact = {
  nodeId: 'sym:deal',
  name: 'DealService',
  likelihood: 'likely',
  impactType: 'logic-change',
  directness: 'direct',
  confidence: 0.7,
  dependencyPath: ['sym:deal'],
  evidenceFiles: ['src/deal.ts'],
  provenance: 'static-analysis',
};

const document = (impactOverrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  command: 'analyze',
  specification: { id: 'sp-1', version: 1, title: 't', extractionMode: 'unchanged' },
  analysis: { id: 'a-1', snapshotId: 's-1', status: 'draft', impactCount: 1 },
  requirements: [
    {
      id: 'req-1',
      statement: 'DealService must hide expired deals.',
      impacts: [{ ...impact, ...impactOverrides }],
      openQuestions: [],
    },
  ],
  warnings: [],
});

describe('analyze document evidence basis (additive v1, ADR-0015)', () => {
  it('accepts an impact WITHOUT the new fields — the prior shape keeps validating', () => {
    expect(cliAnalyzeOutputSchema.safeParse(document()).success).toBe(true);
  });

  it('accepts evidenceTypes and tierCappedBy from the shared vocabulary', () => {
    const parsed = cliAnalyzeOutputSchema.safeParse(
      document({
        evidenceTypes: ['name-similarity', 'lexical-only'],
        tierCappedBy: 'name-similarity',
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const entry = parsed.data.requirements[0]?.impacts[0];
      expect(entry?.evidenceTypes).toEqual(['name-similarity', 'lexical-only']);
      expect(entry?.tierCappedBy).toBe('name-similarity');
    }
  });

  it('rejects a basis outside the closed vocabulary and an empty basis set', () => {
    expect(cliAnalyzeOutputSchema.safeParse(document({ evidenceTypes: ['vibes'] })).success).toBe(
      false,
    );
    expect(cliAnalyzeOutputSchema.safeParse(document({ evidenceTypes: [] })).success).toBe(false);
    expect(
      cliAnalyzeOutputSchema.safeParse(document({ tierCappedBy: 'gut-feeling' })).success,
    ).toBe(false);
  });

  it('reuses the ONE evidence-type vocabulary — no diverging near-duplicate (ADR-0009)', () => {
    for (const value of impactEvidenceTypeSchema.options) {
      expect(
        cliAnalyzeOutputSchema.safeParse(document({ evidenceTypes: [value], tierCappedBy: value }))
          .success,
      ).toBe(true);
    }
  });
});

describe('webview graph node evidence basis (additive v1)', () => {
  const node = {
    id: 'sym:deal',
    name: 'DealService',
    kind: 'impact',
    requirementIds: ['req-1'],
    likelihood: 'likely',
  };

  it('stays additive: a node without the fields still validates', () => {
    expect(impactGraphNodeSchema.safeParse(node).success).toBe(true);
  });

  it('carries the basis set and the tier cap, from the same vocabulary', () => {
    expect(
      impactGraphNodeSchema.safeParse({
        ...node,
        evidenceTypes: ['transitive-structural'],
        tierCappedBy: 'name-similarity',
      }).success,
    ).toBe(true);
    expect(impactGraphNodeSchema.safeParse({ ...node, evidenceTypes: ['vibes'] }).success).toBe(
      false,
    );
  });
});
