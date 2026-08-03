import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { modelProviderError } from '../ports/model-provider.js';

import { clarifySpecification } from './clarify-specification.js';

import type {
  InterpretationDraft,
  SpecificationInterpretationPort,
} from './interpretation-port.js';
import type { GraphEdge, GraphNode, KnowledgeGraph, Specification } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-01T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, category: string, type: string, name: string): GraphNode => {
  const result = createGraphNode({ id, category, type, name, knowledge });
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

// Two disjoint clusters: the policy cluster (application) and the topic cluster (integration),
// so interpretations picking different clusters produce genuinely divergent footprints.
const buildGraph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('sym:policy', 'domain', 'policy', 'DealVisibilityPolicy'),
      node('sym:helper', 'application', 'service', 'VisibilityHelper'),
      node('topic:deal-updated', 'integration', 'topic', 'deal-updated'),
      node('sym:indexer', 'application', 'service', 'DealSearchIndexer'),
    ],
    [
      edge('e1', 'CALLS', 'sym:helper', 'sym:policy'),
      edge('e2', 'SUBSCRIBES_TO', 'sym:indexer', 'topic:deal-updated'),
    ],
  );
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

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

const interpreter = (
  drafts: readonly InterpretationDraft[] | 'error',
): SpecificationInterpretationPort => ({
  interpret: () =>
    Promise.resolve(
      drafts === 'error'
        ? { ok: false, error: modelProviderError('provider-unavailable', 'down') }
        : { ok: true, value: drafts },
    ),
});

const filterReading: InterpretationDraft = {
  title: 'Filter at read time',
  assumption: 'Visibility is computed when deals are read.',
  concepts: ['DealVisibilityPolicy'],
};

describe('clarifySpecification (Stories 15.1–15.3, PRD §C3–§C7)', () => {
  it('materially diverging interpretations yield ONE severity-classified question', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        {
          title: 'Publish expiry events',
          assumption: 'Expiry is broadcast and consumers react.',
          concepts: ['deal-updated'],
        },
      ]),
    });
    expect(outcome.openQuestions).toHaveLength(1);
    const question = outcome.openQuestions[0];
    // event-ownership divergence → blocking (§C6)
    expect(question?.severity).toBe('blocking');
    // §C7: cites actual repository components, not generic phrasing
    expect(question?.question).toContain('deal-updated');
    expect(question?.affectedRequirementIds).toEqual(['req-1']);
    expect(question?.reason).toContain('materially different');
  });

  it('material divergence yields one §C8 option per reading, labeled AI-assisted', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        {
          title: 'Publish expiry events',
          assumption: 'Expiry is broadcast and consumers react.',
          concepts: ['deal-updated'],
        },
      ]),
    });
    expect(outcome.options.map((option) => option.title)).toEqual([
      'Filter at read time',
      'Publish expiry events',
    ]);
    for (const option of outcome.options) {
      expect(option.description).toContain('AI-assisted');
      expect(option.affectedNodeIds.length).toBeGreaterThan(0);
      // §C8: both readings link back to the question they answer, so selecting one resolves it
      expect(option.linkedQuestionId).toBe(outcome.openQuestions[0]?.id);
    }
  });

  it('§26 implications are derived from the footprint, not asserted by the model', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        {
          title: 'Publish expiry events',
          assumption: 'Expiry is broadcast and consumers react.',
          concepts: ['deal-updated'],
        },
      ]),
    });
    const eventOption = outcome.options.find((option) => option.title === 'Publish expiry events');
    const implications = eventOption?.implications;
    expect(implications?.affectedComponentCount).toBeGreaterThan(0);
    // the event cluster is in the footprint → the contract-change and risk statements follow
    expect(implications?.contractChanges.join(' ')).toContain('deal-updated');
    expect(implications?.risks.join(' ')).toContain('event boundary');
    // no test node in this fixture graph → the unverified-change risk is stated
    expect(implications?.risks.join(' ')).toContain('no test node');
    expect(['low', 'medium', 'high']).toContain(implications?.complexity);
  });

  it('questions cite actual repository history for diverging components (§C7)', async () => {
    const topic = createGraphNode({
      id: 'topic:deal-updated',
      category: 'integration',
      type: 'topic',
      name: 'deal-updated',
      path: 'infra/pubsub.tf',
      knowledge,
    });
    if (!topic.ok) {
      throw new Error('topic invalid');
    }
    const base = buildGraph();
    const graphResult = createKnowledgeGraph(
      [...[...base.nodes.values()].filter((n) => n.id !== 'topic:deal-updated'), topic.value],
      [...base.edges.values()],
    );
    if (!graphResult.ok) {
      throw new Error('graph invalid');
    }
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: graphResult.value,
      history: [['infra/pubsub.tf'], ['src/unrelated.ts']],
      interpreter: interpreter([
        filterReading,
        {
          title: 'Publish expiry events',
          assumption: 'Expiry is broadcast and consumers react.',
          concepts: ['deal-updated'],
        },
      ]),
    });
    const reason = outcome.openQuestions[0]?.reason ?? '';
    expect(reason).toContain("History: 'infra/pubsub.tf' changed in 1 of the last 2 commits");
  });

  it('convergent interpretations ask NOTHING (§C3) — same footprint, same implementation', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        { ...filterReading, title: 'Same reading, different words' },
      ]),
    });
    expect(outcome.openQuestions).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });

  it('a single interpretation means no ambiguity — no question (§C3)', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([filterReading]),
    });
    expect(outcome.openQuestions).toEqual([]);
  });

  it('invented concepts match nothing — they cannot fabricate a material divergence (§43.2)', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        {
          title: 'Hallucinated subsystem',
          assumption: 'A quantum cache handles expiry.',
          concepts: ['QuantumExpiryCache', 'NonexistentQueue'],
        },
      ]),
    });
    // the fabricated reading's footprint is empty; divergence equals the REAL reading's
    // footprint (application nodes only) — never blocking on invented data/event nodes
    for (const question of outcome.openQuestions) {
      expect(question.question).not.toContain('QuantumExpiryCache');
      expect(question.severity).not.toBe('blocking');
    }
  });

  it('provider failure degrades silently to zero questions plus a warning (§8)', async () => {
    const outcome = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter('error'),
    });
    expect(outcome.openQuestions).toEqual([]);
    expect(outcome.warnings[0]).toContain('provider-unavailable');
  });

  it('already-asked questions are not duplicated across runs', async () => {
    const first = await clarifySpecification({
      specification: specification(),
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        { title: 'Event reading', assumption: 'Events.', concepts: ['deal-updated'] },
      ]),
    });
    const withQuestion = createSpecification({
      ...specification(),
      openQuestions: [...first.openQuestions],
    });
    if (!withQuestion.ok) {
      throw new Error('spec invalid');
    }
    const second = await clarifySpecification({
      specification: withQuestion.value,
      graph: buildGraph(),
      interpreter: interpreter([
        filterReading,
        { title: 'Event reading', assumption: 'Events.', concepts: ['deal-updated'] },
      ]),
    });
    expect(second.openQuestions).toEqual([]);
  });
});
