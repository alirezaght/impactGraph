import { describe, expect, it } from 'vitest';

import { parseImpactAnalysis, serializeImpactAnalysis } from '../serialization/impact-json.js';

import {
  approveImpactAnalysis,
  createImpactAnalysis,
  supersedeImpactAnalysis,
} from './impact-analysis.js';

import type {
  ArchitecturalOption,
  ImpactAnalysis,
  ProposedNode,
  ProposedRelationship,
} from '../index.js';

// §18.4/§26 proposed structure. The invariants under test are the ones that keep proposed
// knowledge from ever being read as fact: endpoints must resolve, a proposed node may never
// reuse a real node id, and nothing proposed leaks into `requirementImpacts`.

const option: ArchitecturalOption = {
  id: 'opt-events',
  title: 'Publish expiry events',
  description: 'AI-assisted interpretation.',
  affectedNodeIds: ['svc:expiry', 'topic:deal-expired'],
};

const relationship = (overrides: Partial<ProposedRelationship> = {}): ProposedRelationship => ({
  id: 'prop-rel-1',
  sourceId: 'svc:expiry',
  targetId: 'topic:deal-expired',
  sourceKind: 'existing',
  targetKind: 'existing',
  type: 'PUBLISHES',
  status: 'proposed',
  originOptionId: 'opt-events',
  rationale: 'the option names both components; the graph has no relationship between them',
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1'],
  confidence: 0.5,
  confidenceSignals: [{ type: 'framework-convention', contribution: 0.05 }],
  ...overrides,
});

const proposedNode = (overrides: Partial<ProposedNode> = {}): ProposedNode => ({
  id: 'proposed:visibility-projection',
  name: 'VisibilityProjection',
  category: 'data',
  type: 'table',
  originOptionId: 'opt-events',
  rationale: 'the selected option would materialise a projection',
  provenance: 'human-confirmed',
  evidenceIds: [],
  confidence: 1,
  confidenceSignals: [{ type: 'human-confirmed-mapping', contribution: 0.9 }],
  ...overrides,
});

const analysis = (overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-02T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [],
  architecturalOptions: [option],
  warnings: [],
  userDecisions: [],
  ...overrides,
});

const existing = new Set(['svc:expiry', 'topic:deal-expired']);

describe('proposed structure (PRD §18.4, §26)', () => {
  it('accepts a relationship whose endpoints exist in the deterministic graph', () => {
    const result = createImpactAnalysis(
      analysis({ proposedStructure: { nodes: [], relationships: [relationship()] } }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(true);
    // never merged into the current model
    expect(result.ok && result.value.requirementImpacts).toEqual([]);
    expect(result.ok && result.value.proposedStructure?.relationships[0]?.status).toBe('proposed');
  });

  it('rejects a relationship referencing a node that is not in the graph (§34)', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ targetId: 'topic:invented' })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.code).toBe('unknown-node-reference');
  });

  it('rejects a `proposed` endpoint that is not among the declared proposed nodes', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ targetId: 'proposed:nowhere', targetKind: 'proposed' })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.message).toContain('proposed node');
  });

  it('accepts a proposed endpoint when the proposed node is declared alongside it', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [proposedNode()],
          relationships: [
            relationship({ targetId: 'proposed:visibility-projection', targetKind: 'proposed' }),
          ],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a proposed node that reuses a real graph node id — proposals never shadow facts', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: { nodes: [proposedNode({ id: 'svc:expiry' })], relationships: [] },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.code).toBe('duplicate-id');
  });

  it('requires provenance, evidence and stored confidence signals like any knowledge record', () => {
    const bare = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ evidenceIds: [], confidenceSignals: [] })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(bare.ok).toBe(false);
    const codes = !bare.ok ? bare.error.issues.map((issue) => issue.code) : [];
    expect(codes).toContain('missing-evidence');
    expect(codes).toContain('missing-signals');
  });

  it('rejects a proposal that cites an architectural option the analysis does not carry', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ originOptionId: 'opt-ghost' })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.path).toBe(
      'proposedStructure.relationships[0].originOptionId',
    );
  });

  it("rejects a relationship that does not carry status 'proposed'", () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ status: 'current' as 'proposed' })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.message).toContain('never current structure');
  });

  it('rejects an edge type outside the §12.2 vocabulary', () => {
    const result = createImpactAnalysis(
      analysis({
        proposedStructure: {
          nodes: [],
          relationships: [relationship({ type: 'MAYBE_TALKS_TO' as 'PUBLISHES' })],
        },
      }),
      { existingNodeIds: existing },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.issues[0]?.code).toBe('unknown-edge-type');
  });

  it('round-trips through the v1 artifact, and prior artifacts without the field still parse', () => {
    const built = createImpactAnalysis(
      analysis({
        proposedStructure: { nodes: [proposedNode()], relationships: [relationship()] },
      }),
      { existingNodeIds: existing },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const json = JSON.parse(JSON.stringify(serializeImpactAnalysis(built.value))) as unknown;
    const reparsed = parseImpactAnalysis(json);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.ok && reparsed.value.proposedStructure).toEqual(built.value.proposedStructure);

    const priorVersion = { ...(json as Record<string, unknown>) };
    delete priorVersion['proposedStructure'];
    const legacy = parseImpactAnalysis(priorVersion);
    expect(legacy.ok).toBe(true);
    expect(legacy.ok && legacy.value.proposedStructure).toBeUndefined();
  });

  it('survives approval unchanged — proposals belong to the version that produced them', () => {
    const built = createImpactAnalysis(
      analysis({ proposedStructure: { nodes: [], relationships: [relationship()] } }),
      { existingNodeIds: existing },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    // frozen: no code path can edit the proposals of an analysis that already exists
    expect(() => {
      (built.value.proposedStructure?.nodes as unknown as unknown[]).push({});
    }).toThrow();
    // and approval carries them through byte-identically onto the approved version
    const approved = approveImpactAnalysis(built.value);
    expect(approved.ok).toBe(true);
    expect(approved.ok && approved.value.proposedStructure).toEqual(built.value.proposedStructure);
    const superseded = approved.ok ? supersedeImpactAnalysis(approved.value) : undefined;
    expect(superseded?.ok === true && superseded.value.proposedStructure).toEqual(
      built.value.proposedStructure,
    );
  });
});
