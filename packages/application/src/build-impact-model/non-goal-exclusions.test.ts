import {
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
  specNoteId,
  stableRequirementId,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactModel } from './build-impact-model.js';

import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  Specification,
  SpecNote,
} from '@impactgraph/domain';

// Item 1: "Non-goals must act as exclusions or contradiction signals, not positive impacts."

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-04T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
} as const;

const node = (id: string, name: string, type = 'class'): GraphNode => {
  const created = createGraphNode({
    id,
    type,
    name,
    category: 'application',
    path: `src/${name}.ts`,
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`node ${id}`);
  }
  return created.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const created = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!created.ok) {
    throw new Error(`edge ${id}`);
  }
  return created.value;
};

const graph = (): KnowledgeGraph => {
  const created = createKnowledgeGraph(
    [
      node('sym:renderer', 'MessageRenderer'),
      node('sym:mailer', 'LegacyMailer'),
      node('sym:notifier', 'Notifier'),
    ],
    [
      // Notifier CALLS LegacyMailer, so LegacyMailer is reachable at one hop from Notifier.
      edge('e1', 'CALLS', 'sym:notifier', 'sym:mailer'),
      edge('e2', 'CALLS', 'sym:notifier', 'sym:renderer'),
    ],
  );
  if (!created.ok) {
    throw new Error('graph');
  }
  return created.value;
};

const specification = (
  statements: readonly string[],
  notes: readonly SpecNote[],
): Specification => {
  const created = createSpecification({
    id: 'spec-1',
    title: 'NDA notification',
    sourceType: 'markdown',
    rawText: statements.join('\n'),
    version: 1,
    createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T10:00:00.000Z',
    requirements: statements.map((statement) => ({
      id: stableRequirementId(statement),
      statement,
      type: 'functional' as const,
      concepts: [...statement.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''),
      actors: [],
      status: 'draft' as const,
      origin: 'explicit-label' as const,
    })),
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
    notes,
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const nonGoal = (statement: string): SpecNote => ({
  id: specNoteId('non-goal', statement),
  kind: 'non-goal',
  statement,
});

const build = (spec: Specification) =>
  buildImpactModel({
    specification: spec,
    graph: graph(),
    repositorySnapshotId: 'snap-1',
    analysisId: 'analysis-1',
    createdAt: '2026-08-04T10:00:00.000Z',
  });

describe('non-goal exclusions', () => {
  it('downgrades a reachable impact the non-goal names to the excluded tier', () => {
    const result = build(
      specification(
        ['`Notifier` must send the NDA request message.'],
        [nonGoal('Reworking `LegacyMailer`.')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mailer = result.value.requirementImpacts.find((impact) => impact.nodeId === 'sym:mailer');
    expect(mailer?.likelihood).toBe('excluded');
    expect(mailer?.explanation).toContain('non-goal');
    expect(result.value.warnings.map((warning) => warning.code)).toContain('non-goal-exclusion');
  });

  it('leaves impacts the non-goal does not name alone', () => {
    const result = build(
      specification(
        ['`Notifier` must send the NDA request message.'],
        [nonGoal('Reworking `LegacyMailer`.')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const renderer = result.value.requirementImpacts.find(
      (impact) => impact.nodeId === 'sym:renderer',
    );
    expect(renderer?.likelihood).toBe('likely');
  });

  it('never turns a non-goal into a positive impact of its own', () => {
    const result = build(
      specification(
        ['`Notifier` must send the NDA request message.'],
        [nonGoal('Adding SMS support to `MessageRenderer`.')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // MessageRenderer is reachable from Notifier, so it appears — but at the excluded tier, and
    // no requirement is attributed to the non-goal statement itself.
    const requirementIds = new Set(
      result.value.requirementImpacts.map((impact) => impact.requirementId),
    );
    expect(requirementIds.size).toBe(1);
    expect(
      result.value.requirementImpacts.find((impact) => impact.nodeId === 'sym:renderer')
        ?.likelihood,
    ).toBe('excluded');
  });

  it('reports a contradiction instead of silencing a required impact', () => {
    const result = build(
      specification(
        ['`MessageRenderer` must interpolate the buyer name.'],
        [nonGoal('Changing `MessageRenderer`.')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const renderer = result.value.requirementImpacts.find(
      (impact) => impact.nodeId === 'sym:renderer',
    );
    expect(renderer?.likelihood).toBe('required');
    expect(result.value.warnings.map((warning) => warning.code)).toContain(
      'non-goal-contradiction',
    );
  });

  it('says so when a non-goal resolves to nothing, rather than excluding at random', () => {
    const result = build(
      specification(
        ['`Notifier` must send the NDA request message.'],
        [nonGoal('Reworking the `SmsGateway`.')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const unresolved = result.value.warnings.filter(
      (warning) => warning.code === 'unresolved-concept',
    );
    expect(unresolved.some((warning) => warning.message.includes('SmsGateway'))).toBe(true);
    expect(
      result.value.requirementImpacts.every((impact) => impact.likelihood !== 'excluded'),
    ).toBe(true);
  });
});

describe('unresolved concepts are never invented as nodes', () => {
  it('reports a specification term that matches no artifact', () => {
    const result = build(
      specification(['`NOTIFICATION_TOPIC_ID` must be configured for the push route.'], []),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const unresolved = result.value.warnings.filter(
      (warning) => warning.code === 'unresolved-concept',
    );
    expect(unresolved[0]?.message).toContain('NOTIFICATION_TOPIC_ID');
    expect(unresolved[0]?.message).toContain('No node was created for it');
    // The critical assertion: nothing named after the concept entered the analysis.
    expect(
      result.value.requirementImpacts.some((impact) =>
        impact.nodeId.includes('NOTIFICATION_TOPIC_ID'),
      ),
    ).toBe(false);
  });
});

describe('provisional extraction taints the analysis', () => {
  it('warns when the requirement list was extractor prose', () => {
    const spec = specification(['`Notifier` must send the message.'], []);
    const provisional = createSpecification({
      ...spec,
      extractionQuality: {
        strategy: 'prose-fallback',
        structuredRequirementCount: 0,
        proseRequirementCount: 1,
        recognizedSections: [],
        provisional: true,
        warnings: ['FALLBACK EXTRACTION: …'],
      },
    });
    expect(provisional.ok).toBe(true);
    if (!provisional.ok) {
      return;
    }
    const result = build(provisional.value);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const codes = result.value.warnings.map((warning) => warning.code);
    expect(codes).toContain('provisional-extraction');
    expect(
      result.value.warnings.find((warning) => warning.code === 'provisional-extraction')?.message,
    ).toContain('PROVISIONAL ANALYSIS');
  });
});
