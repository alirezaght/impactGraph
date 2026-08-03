import { describe, expect, it } from 'vitest';

import {
  HOST_MESSAGE_TYPES,
  WEBVIEW_MESSAGE_TYPES,
  WEBVIEW_PROTOCOL_VERSION,
  evidencePanelStateSchema,
  hostMessageSchema,
  impactGraphSchema,
  knowledgeCategoryForProvenance,
  parseHostMessage,
  parseWebviewMessage,
  specificationPanelStateSchema,
  webviewMessageSchema,
} from '../index.js';

const versioned = (type: string, payload: unknown): unknown => ({
  protocolVersion: WEBVIEW_PROTOCOL_VERSION,
  type,
  payload,
});

const emptySpecState = {
  schemaVersion: 1,
  status: 'empty',
  requirements: [],
  openQuestions: [],
  availableVersions: [],
  warnings: [],
};

describe('webview protocol envelope (PRD §29.2)', () => {
  it('accepts a well-formed host message', () => {
    const result = parseHostMessage(versioned('host/specification', { state: emptySpecState }));
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown protocol version as a TYPED error, never best-effort', () => {
    const result = parseHostMessage({
      protocolVersion: 99,
      type: 'host/specification',
      payload: { state: emptySpecState },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('unsupported-protocol-version');
    expect(result.error.message).toContain('v99');
  });

  it('rejects an unknown message type', () => {
    const result = parseHostMessage(versioned('host/telemetry', {}));
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('unknown-type');
  });

  it('rejects a known type with an invalid payload', () => {
    const result = parseWebviewMessage(versioned('webview/impact-decision', { nodeId: 'n1' }));
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('invalid-payload');
  });

  it('rejects a non-envelope value', () => {
    expect(parseHostMessage('hello').ok).toBe(false);
    expect(parseHostMessage(undefined).ok).toBe(false);
    expect(parseWebviewMessage({ type: 'webview/ready' }).ok).toBe(false);
  });

  it('rejects unknown keys inside a payload (strict boundary)', () => {
    const result = parseWebviewMessage(
      versioned('webview/open-source', { path: 'src/a.ts', extra: true }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('message rosters stay in sync with the schemas', () => {
  it('every host message type is listed', () => {
    const inSchema = hostMessageSchema.options.map((option) => option.shape.type.value);
    expect([...HOST_MESSAGE_TYPES].sort()).toEqual([...inSchema].sort());
  });

  it('every webview message type is listed', () => {
    const inSchema = webviewMessageSchema.options.map((option) => option.shape.type.value);
    expect([...WEBVIEW_MESSAGE_TYPES].sort()).toEqual([...inSchema].sort());
  });
});

describe('panel DTOs (PRD §18.2/§18.4/§18.5)', () => {
  it('an impact graph reports the pre-cap total so truncation is never silent (§43.1)', () => {
    const graph = impactGraphSchema.parse({
      schemaVersion: 1,
      status: 'loaded',
      analysisId: 'an-1',
      requirements: [{ id: 'req-1', statement: 'Deals must be visible to owners' }],
      nodes: [
        {
          id: 'node-1',
          name: 'DealService',
          kind: 'impact',
          requirementIds: ['req-1'],
          likelihood: 'required',
          impactType: 'logic-change',
          directness: 'direct',
          confidence: 0.88,
          provenance: 'static-analysis',
          knowledgeCategory: 'deterministic',
        },
      ],
      edges: [],
      totalNodeCount: 412,
      warnings: [],
    });
    expect(graph.totalNodeCount).toBe(412);
    expect(graph.nodes).toHaveLength(1);
  });

  it('an evidence panel can report absence explicitly instead of faking a result', () => {
    const state = evidencePanelStateSchema.parse({
      schemaVersion: 1,
      status: 'unavailable',
      message: 'no index generation — run "Reindex Workspace"',
      humanDecisions: [],
      warnings: [],
    });
    expect(state.explanation).toBeUndefined();
    expect(state.impact).toBeUndefined();
  });

  it('a specification panel state keeps requirements and questions separate', () => {
    const state = specificationPanelStateSchema.parse({
      ...emptySpecState,
      status: 'loaded',
      specification: { id: 'spec-a', version: 2, title: 'A', rawText: '# A' },
      requirements: [
        {
          id: 'req-1',
          statement: 'Owners see their deals',
          type: 'functional',
          status: 'extracted',
          concepts: ['deal'],
          actors: ['owner'],
        },
      ],
      openQuestions: [
        {
          id: 'q-1',
          question: 'Which visibility rule applies to archived deals?',
          reason: 'two candidate policies',
          severity: 'blocking',
          status: 'open',
          affectedRequirementIds: ['req-1'],
        },
      ],
      availableVersions: [1, 2],
    });
    expect(state.requirements).toHaveLength(1);
    expect(state.openQuestions[0]?.severity).toBe('blocking');
  });
});

describe('§18.4 proposed structure on the impact graph DTO', () => {
  const relationship = {
    id: 'prop-rel-1',
    sourceId: 'node-policy',
    targetId: 'prop-node-1',
    sourceKind: 'existing',
    targetKind: 'proposed',
    type: 'data-dependency',
    status: 'proposed',
    originOptionId: 'opt-read-model',
    originOptionTitle: 'Introduce a deal read model',
    rationale: 'the option moves visibility filtering behind a projection',
    provenance: 'llm-inferred',
    knowledgeCategory: 'ai-inferred',
    evidenceIds: ['ev-1'],
    confidence: 0.62,
    confidenceSignals: [{ type: 'option-footprint', contribution: 0.2 }],
  };

  const graph = {
    schemaVersion: 1,
    status: 'loaded',
    analysisId: 'an-1',
    requirements: [{ id: 'req-1', statement: 'Owners see their own deals' }],
    nodes: [
      {
        id: 'node-policy',
        name: 'DealVisibilityPolicy',
        kind: 'impact',
        requirementIds: ['req-1'],
      },
    ],
    edges: [],
    totalNodeCount: 2,
    proposedStructure: {
      nodes: [
        {
          id: 'prop-node-1',
          name: 'DealProjection',
          category: 'component',
          type: 'service',
          originOptionId: 'opt-read-model',
          rationale: 'the option needs a projection to read from',
          provenance: 'llm-inferred',
          evidenceIds: ['ev-1'],
          confidence: 0.55,
          confidenceSignals: [{ type: 'option-footprint', contribution: 0.15 }],
        },
      ],
      relationships: [relationship],
    },
    warnings: [],
  };

  it('round-trips a graph carrying proposed nodes and relationships', () => {
    const parsed = impactGraphSchema.parse(graph);
    expect(parsed).toEqual(graph);
    expect(impactGraphSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('keeps the proposed half OUT of `nodes`/`edges` — the two are never merged (§3)', () => {
    const parsed = impactGraphSchema.parse(graph);
    expect(parsed.nodes.map((node) => node.id)).toEqual(['node-policy']);
    expect(parsed.edges).toEqual([]);
    expect(parsed.proposedStructure?.relationships[0]?.status).toBe('proposed');
  });

  it('stays additive: a graph without proposed structure is still valid and reports absence', () => {
    const withoutProposals: Record<string, unknown> = { ...graph, totalNodeCount: 1 };
    delete withoutProposals['proposedStructure'];
    expect(impactGraphSchema.parse(withoutProposals).proposedStructure).toBeUndefined();
  });

  it('rejects a relationship that is not marked proposed', () => {
    const merged = {
      ...graph,
      proposedStructure: {
        nodes: graph.proposedStructure.nodes,
        relationships: [{ ...relationship, status: 'current' }],
      },
    };
    expect(impactGraphSchema.safeParse(merged).success).toBe(false);
  });

  it('rejects an unknown endpoint kind, a missing rationale and an out-of-range confidence', () => {
    const invalid = [
      { ...relationship, sourceKind: 'imagined' },
      { ...relationship, rationale: '' },
      { ...relationship, confidence: 1.4 },
      { ...relationship, originOptionId: '' },
      { ...relationship, unexpectedKey: true },
    ];
    for (const candidate of invalid) {
      expect(
        impactGraphSchema.safeParse({
          ...graph,
          proposedStructure: { nodes: [], relationships: [candidate] },
        }).success,
      ).toBe(false);
    }
  });

  it('requires the §14 signal array so a proposal can never show a bare number', () => {
    const withoutSignals: Record<string, unknown> = { ...relationship };
    delete withoutSignals['confidenceSignals'];
    expect(
      impactGraphSchema.safeParse({
        ...graph,
        proposedStructure: { nodes: [], relationships: [withoutSignals] },
      }).success,
    ).toBe(false);
  });

  it('travels inside a host/graph message, validated like every other payload', () => {
    const result = parseHostMessage(versioned('host/graph', { graph }));
    expect(result.ok).toBe(true);
    const broken = parseHostMessage(
      versioned('host/graph', {
        graph: {
          ...graph,
          proposedStructure: { nodes: [], relationships: [{ ...relationship, confidence: 2 }] },
        },
      }),
    );
    expect(broken.ok).toBe(false);
  });
});

describe('knowledgeCategoryForProvenance (§3, ADR-0002)', () => {
  it('maps each deterministic provenance to deterministic', () => {
    for (const provenance of ['static-analysis', 'configuration', 'git-history']) {
      expect(knowledgeCategoryForProvenance(provenance)).toBe('deterministic');
    }
  });

  it('never promotes an inference or an unknown value to a fact', () => {
    expect(knowledgeCategoryForProvenance('llm-inferred')).toBe('ai-inferred');
    expect(knowledgeCategoryForProvenance('human-confirmed')).toBe('human-confirmed');
    expect(knowledgeCategoryForProvenance('made-up')).toBeUndefined();
    expect(knowledgeCategoryForProvenance(undefined)).toBeUndefined();
  });
});
