import {
  changeExpectationOf,
  createGraphEdge,
  createGraphNode,
  createKnowledgeGraph,
  createSpecification,
  stableRequirementId,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactModel } from './build-impact-model.js';

import type {
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementIntent,
  Specification,
} from '@impactgraph/domain';

/**
 * A preservation requirement carries its meaning all the way into the impact model: the surface it
 * names is IN scope, expected to be exercised, and expected to show no diff. That is
 * `changeExpectation: 'preserve'` — the third no-change reading beside planned reuse and
 * verification, and the only one the author stated as a boundary rather than a design choice.
 *
 * The guard applies to the surface the requirement ANCHORED on, never to the neighbourhood a
 * traversal reached from it. "The send job must not change" says nothing about what its callers
 * may do, and silently protecting them would manufacture violations out of ordinary work.
 */

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-17T10:00:00.000Z',
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

const graph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('sym:sendJob', 'application', 'service', 'SendJob'),
      node('file:sendJob', 'repository', 'file', 'send-job.ts'),
      node('file:caller', 'repository', 'file', 'digest-scheduler.ts'),
    ],
    [
      edge('e1', 'CONTAINS', 'file:sendJob', 'sym:sendJob'),
      edge('e2', 'IMPORTS', 'file:caller', 'file:sendJob'),
    ],
  );
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const STATEMENT = 'The `SendJob` must not change behavior.';

const spec = (intent: RequirementIntent | undefined): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Weekly digest',
    sourceType: 'markdown',
    rawText: STATEMENT,
    version: 1,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
    requirements: [
      {
        id: stableRequirementId(STATEMENT),
        statement: STATEMENT,
        type: 'functional',
        concepts: ['SendJob'],
        actors: [],
        status: 'draft',
        ...(intent === undefined ? {} : { intent }),
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

const run = (intent: RequirementIntent | undefined): ImpactAnalysis => {
  const result = buildImpactModel({
    specification: spec(intent),
    graph: graph(),
    repositorySnapshotId: 'snap-1',
    analysisId: 'analysis-1',
    createdAt: '2026-08-17T10:00:00.000Z',
  });
  if (!result.ok) {
    throw new Error('buildImpactModel failed');
  }
  return result.value;
};

describe('a preserve-intent requirement in the impact model', () => {
  const analysis = run('preserve');
  const anchor = analysis.requirementImpacts.find((impact) => impact.nodeId === 'sym:sendJob');

  it('resolves the protected concept to a real impact — the surface stays in scope', () => {
    expect(anchor).toBeDefined();
    expect(anchor?.likelihood).not.toBe('excluded');
  });

  it('marks the anchored surface as preserve', () => {
    expect(anchor?.changeExpectation).toBe('preserve');
    expect(anchor === undefined ? undefined : changeExpectationOf(anchor)).toBe('preserve');
  });

  it('explains the expectation in the plan, so a reader can audit it', () => {
    expect(anchor?.expectedChanges.join(' ')).toContain('preserve');
  });

  it('does not extend the guard to surfaces the traversal merely reached', () => {
    const reached = analysis.requirementImpacts.filter((impact) => impact.nodeId !== 'sym:sendJob');
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.every((impact) => changeExpectationOf(impact) === 'must-change')).toBe(true);
  });
});

describe('a change-intent requirement is untouched', () => {
  it('keeps the default must-change reading', () => {
    const analysis = run(undefined);
    const anchor = analysis.requirementImpacts.find((impact) => impact.nodeId === 'sym:sendJob');
    expect(anchor?.changeExpectation).toBeUndefined();
    expect(anchor === undefined ? undefined : changeExpectationOf(anchor)).toBe('must-change');
  });
});

describe('a guard is not a non-goal', () => {
  const withNonGoal = (): Specification => {
    const base = spec('preserve');
    const result = createSpecification({
      ...base,
      notes: [
        {
          id: 'note-non-goal-1',
          kind: 'non-goal',
          statement: 'Reworking the `SendJob` retry policy.',
        },
      ],
    });
    if (!result.ok) {
      throw new Error('spec invalid');
    }
    return result.value;
  };

  it('rules the component out for a non-goal, and keeps it in for a guard', () => {
    const excluded = buildImpactModel({
      specification: withNonGoal(),
      graph: graph(),
      repositorySnapshotId: 'snap-1',
      analysisId: 'analysis-2',
      createdAt: '2026-08-17T10:00:00.000Z',
    });
    if (!excluded.ok) {
      throw new Error('buildImpactModel failed');
    }
    // The non-goal names the same node on purpose: an exclusion is a different, stronger statement
    // about the SAME surface, and the analysis must say so out loud.
    expect(excluded.value.warnings.map((warning) => warning.code)).toContain(
      'non-goal-contradiction',
    );

    // A guard says nothing of the kind: the surface is in scope, predicted, and expected to be
    // exercised — it just must not come out different.
    const guardOnly = run('preserve');
    expect(guardOnly.warnings.some((warning) => warning.code.startsWith('non-goal'))).toBe(false);
    const guarded = guardOnly.requirementImpacts.find((impact) => impact.nodeId === 'sym:sendJob');
    expect(guarded?.likelihood).not.toBe('excluded');
    expect(guarded === undefined ? undefined : changeExpectationOf(guarded)).toBe('preserve');
  });
});
