import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildCoChangeIndex } from '../history/co-change-index.js';

import { clarifySpecification } from './clarify-specification.js';
import { deriveProposedRelationships } from './proposed-relationships.js';

import type {
  InterpretationDraft,
  SpecificationInterpretationPort,
} from './interpretation-port.js';
import type {
  ArchitecturalOption,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  Specification,
} from '@impactgraph/domain';

// §18.4/§26 — proposed relationships. The behaviour that matters: a divergent option that pairs
// a publisher with an event target the graph does not connect yields a proposal; anything the
// graph already relates, or any pair whose direction the §12 vocabulary does not fix, does not.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-01T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (
  id: string,
  category: string,
  spec: { readonly type: string; readonly name: string; readonly path?: string },
): GraphNode => {
  const { type, name, path } = spec;
  const result = createGraphNode({
    id,
    category,
    type,
    name,
    knowledge: { ...knowledge, evidenceIds: [`ev-${id}`] },
    ...(path === undefined ? {} : { path }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

/**
 * `DealExpiryService` computes expiry and CALLS the policy. `deal-expired` is a topic nobody
 * publishes to; `DealSearchIndexer` subscribes to it. Nothing links the expiry service to the
 * topic — the gap an "publish expiry events" reading would close.
 */
const buildGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('sym:policy', 'domain', {
        type: 'policy',
        name: 'DealVisibilityPolicy',
        path: 'src/policy.ts',
      }),
      node('svc:expiry', 'application', {
        type: 'service',
        name: 'DealExpiryService',
        path: 'src/expiry.ts',
      }),
      node('topic:deal-expired', 'integration', {
        type: 'topic',
        name: 'deal-expired',
        path: 'infra/pubsub.tf',
      }),
      node('svc:indexer', 'application', {
        type: 'service',
        name: 'DealSearchIndexer',
        path: 'src/indexer.ts',
      }),
      node('tbl:deals', 'data', { type: 'table', name: 'deals', path: 'db/deals.sql' }),
    ],
    [
      edge('e1', 'CALLS', 'svc:expiry', 'sym:policy'),
      edge('e2', 'SUBSCRIBES_TO', 'svc:indexer', 'topic:deal-expired'),
    ],
  );
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const option = (affectedNodeIds: readonly string[]): ArchitecturalOption => ({
  id: 'opt-events',
  title: 'Publish expiry events',
  description: 'AI-assisted interpretation.',
  affectedNodeIds: [...affectedNodeIds],
});

const noHistory = buildCoChangeIndex([]);

describe('deriveProposedRelationships (PRD §18.4, §26)', () => {
  it('proposes PUBLISHES for a publisher/topic pair the graph does not connect', () => {
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:deal-expired']),
      noHistory,
    );
    expect(derived.relationships).toHaveLength(1);
    const proposal = derived.relationships[0];
    expect(proposal).toMatchObject({
      sourceId: 'svc:expiry',
      targetId: 'topic:deal-expired',
      type: 'PUBLISHES',
      status: 'proposed',
      sourceKind: 'existing',
      targetKind: 'existing',
      originOptionId: 'opt-events',
      // AI-assisted, because the footprint pairing the two came from an interpretation (§26)
      provenance: 'llm-inferred',
      // evidence comes from the two REAL endpoints, so every proposal is traceable
      evidenceIds: ['ev-svc:expiry', 'ev-topic:deal-expired'],
    });
    expect(proposal?.rationale).toContain('no relationship between them');
  });

  it('stores the signals its confidence was computed from (§14) — never a bare number', () => {
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:deal-expired']),
      noHistory,
    );
    const proposal = derived.relationships[0];
    const types = proposal?.confidenceSignals.map((signal) => signal.type) ?? [];
    expect(types).toContain('framework-convention');
    expect(types).toContain('event-relationship');
    // the model-authored half of the inference is penalised, visibly
    expect(types).toContain('unsupported-inference');
    const total = (proposal?.confidenceSignals ?? []).reduce(
      (sum, signal) => sum + signal.contribution,
      0,
    );
    expect(proposal?.confidence).toBeCloseTo(Math.round(total * 100) / 100, 5);
    expect(proposal?.confidence).toBeLessThan(1);
  });

  it('adds the co-change signal when the two files already change together (§14)', () => {
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:deal-expired']),
      buildCoChangeIndex([['src/expiry.ts', 'infra/pubsub.tf'], ['src/other.ts']]),
    );
    const types = derived.relationships[0]?.confidenceSignals.map((signal) => signal.type) ?? [];
    expect(types).toContain('historical-co-change');
  });

  it('proposes SUBSCRIBES_TO — the target node type fixes the direction, not a guess', () => {
    const base = buildGraph();
    const graph = createKnowledgeGraph(
      [
        ...base.nodes.values(),
        node('sub:expiry-worker', 'integration', {
          type: 'subscription',
          name: 'expiry-worker-sub',
        }),
      ],
      [...base.edges.values()],
    );
    if (!graph.ok) {
      throw new Error('graph invalid');
    }
    const derived = deriveProposedRelationships(
      graph.value,
      option(['svc:indexer', 'sub:expiry-worker']),
      noHistory,
    );
    expect(derived.relationships.map((entry) => entry.type)).toEqual(['SUBSCRIBES_TO']);
  });

  it('proposes NOTHING when the graph already relates the pair', () => {
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:indexer', 'topic:deal-expired']),
      noHistory,
    );
    expect(derived.relationships).toEqual([]);
  });

  it('proposes NOTHING through an existing intermediary (a two-hop path is a relationship)', () => {
    const base = buildGraph();
    const graph = createKnowledgeGraph(
      [
        ...base.nodes.values(),
        node('sym:publisher', 'integration', { type: 'publisher', name: 'ExpiryPublisher' }),
      ],
      [
        ...base.edges.values(),
        edge('e3', 'CALLS', 'svc:expiry', 'sym:publisher'),
        edge('e4', 'PUBLISHES', 'sym:publisher', 'topic:deal-expired'),
      ],
    );
    if (!graph.ok) {
      throw new Error('graph invalid');
    }
    const derived = deriveProposedRelationships(
      graph.value,
      option(['svc:expiry', 'topic:deal-expired']),
      noHistory,
    );
    expect(derived.relationships).toEqual([]);
  });

  it('proposes NOTHING for pairs whose direction the §12 vocabulary does not fix (data)', () => {
    // svc:expiry and the `deals` table are unconnected, but READS_FROM vs WRITES_TO is a guess
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'tbl:deals']),
      noHistory,
    );
    expect(derived.relationships).toEqual([]);
  });

  it('ignores footprint ids that are not in the graph — a proposal cannot invent an endpoint', () => {
    const derived = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:invented-by-the-model']),
      noHistory,
    );
    expect(derived.relationships).toEqual([]);
  });

  it('is deterministic: the same option and graph produce byte-identical records', () => {
    const first = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:deal-expired']),
      noHistory,
    );
    const second = deriveProposedRelationships(
      buildGraph(),
      option(['svc:expiry', 'topic:deal-expired']),
      noHistory,
    );
    expect(first.relationships).toEqual(second.relationships);
  });
});

const specification = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: 'Expired deals must disappear.',
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'Expired deals must disappear.',
        type: 'functional',
        concepts: [],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('spec invalid');
  }
  return result.value;
};

const interpreter = (drafts: readonly InterpretationDraft[]): SpecificationInterpretationPort => ({
  interpret: () => Promise.resolve({ ok: true, value: drafts }),
});

const filterReading: InterpretationDraft = {
  title: 'Filter at read time',
  assumption: 'Visibility is computed when deals are read.',
  concepts: ['DealVisibilityPolicy'],
};

describe('clarifySpecification proposed structure (§C3 + §18.4)', () => {
  it('a divergent event reading yields proposed relationships bound to its option', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        {
          title: 'Publish expiry events',
          assumption: 'Expiry is broadcast and consumers react.',
          concepts: ['DealExpiryService', 'deal-expired'],
        },
      ]),
    });
    const proposals = outcome.proposedStructure.relationships;
    expect(proposals.length).toBeGreaterThan(0);
    const optionIds = new Set(outcome.options.map((entry) => entry.id));
    for (const proposal of proposals) {
      expect(optionIds.has(proposal.originOptionId)).toBe(true);
      expect(proposal.status).toBe('proposed');
    }
    expect(
      proposals.some(
        (proposal) => proposal.type === 'PUBLISHES' && proposal.targetId === 'topic:deal-expired',
      ),
    ).toBe(true);
    // v1 asserts no proposed COMPONENTS — an unmatched concept is not evidence of one
    expect(outcome.proposedStructure.nodes).toEqual([]);
  });

  it('convergent readings yield no options and therefore no proposed structure (§C3)', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        { ...filterReading, title: 'Same reading, different words' },
      ]),
    });
    expect(outcome.options).toEqual([]);
    expect(outcome.proposedStructure).toEqual({ nodes: [], relationships: [] });
  });
});
