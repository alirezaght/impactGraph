import { describe, expect, it } from 'vitest';

import { computeReadiness } from './readiness.js';
import { createSpecification } from './specification.js';

import type { OpenQuestion, Specification } from './specification.js';

const question = (
  id: string,
  severity: OpenQuestion['severity'],
  status: OpenQuestion['status'] = 'open',
): OpenQuestion => ({
  id,
  question: `question ${id}?`,
  reason: 'competing interpretations diverge',
  affectedRequirementIds: ['req-1'],
  severity,
  status,
  ...(status === 'answered' ? { answer: 'decided' } : {}),
});

const spec = (questions: OpenQuestion[], requirementCount = 1): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'T',
    sourceType: 'markdown',
    rawText: 'DealService must filter expired deals.',
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: Array.from({ length: requirementCount }, (_, index) => ({
      id: `req-${String(index + 1)}`,
      statement: `Requirement ${String(index + 1)} must hold.`,
      type: 'functional',
      concepts: ['DealService'],
      actors: [],
      status: 'draft',
    })),
    actors: [],
    constraints: [],
    openQuestions: questions,
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('spec invalid');
  }
  return result.value;
};

describe('computeReadiness (Story 15.6, PRD §C10)', () => {
  it('a spec with requirements and no open questions is ready', () => {
    const readiness = computeReadiness(spec([]));
    expect(readiness.score).toBe(100);
    expect(readiness.blockingQuestions).toBe(0);
    expect(readiness.recommendedAction).toBe('Ready for implementation.');
  });

  it('a spec without requirements is not ready at all', () => {
    const readiness = computeReadiness(spec([], 0));
    expect(readiness.score).toBe(0);
    expect(readiness.recommendedAction).toContain('requirement');
  });

  it('counts only OPEN questions per severity and names the blocker in the action', () => {
    const readiness = computeReadiness(
      spec([
        question('q1', 'blocking'),
        question('q2', 'important'),
        question('q3', 'important', 'answered'),
        question('q4', 'minor'),
        question('q5', 'minor', 'dismissed'),
      ]),
    );
    expect(readiness.blockingQuestions).toBe(1);
    expect(readiness.importantQuestions).toBe(1);
    expect(readiness.minorQuestions).toBe(1);
    expect(readiness.recommendedAction).toContain('blocking');
    expect(readiness.score).toBeLessThan(100);
  });

  it('is not ready while requirements matched nothing in the repository', () => {
    const readiness = computeReadiness(spec([], 2), { unmatchedRequirementIds: ['req-2'] });

    expect(readiness.unmatchedRequirements).toBe(1);
    expect(readiness.score).toBeLessThan(100);
    expect(readiness.recommendedAction).not.toBe('Ready for implementation.');
    expect(readiness.recommendedAction).toContain('1');
  });

  it('treats every requirement unmatched as the worst coverage case', () => {
    const none = computeReadiness(spec([], 2), {
      unmatchedRequirementIds: ['req-1', 'req-2'],
    });
    const half = computeReadiness(spec([], 2), { unmatchedRequirementIds: ['req-1'] });

    expect(none.score).toBeLessThan(half.score);
  });

  it('ignores unmatched ids that are not requirements of this specification', () => {
    const readiness = computeReadiness(spec([], 1), { unmatchedRequirementIds: ['req-9'] });

    expect(readiness.unmatchedRequirements).toBe(0);
    expect(readiness.score).toBe(100);
  });

  it('omits the coverage count when no coverage information is supplied', () => {
    expect(computeReadiness(spec([], 2)).unmatchedRequirements).toBeUndefined();
  });

  it('a blocking question still outranks poor coverage in the recommended action', () => {
    const readiness = computeReadiness(spec([question('q1', 'blocking')], 2), {
      unmatchedRequirementIds: ['req-2'],
    });

    expect(readiness.recommendedAction).toContain('blocking');
  });

  it('is deterministic and reproducible — same state, same score (§C10)', () => {
    const state = spec([question('q1', 'important')]);
    expect(computeReadiness(state)).toEqual(computeReadiness(state));
  });

  it('answering a blocking question raises the score (15.6 acceptance)', () => {
    const before = computeReadiness(spec([question('q1', 'blocking')]));
    const after = computeReadiness(spec([question('q1', 'blocking', 'answered')]));
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.blockingQuestions).toBe(0);
  });

  it('blocking weighs more than important, important more than minor (§C6 ordering)', () => {
    const blocking = computeReadiness(spec([question('q', 'blocking')])).score;
    const important = computeReadiness(spec([question('q', 'important')])).score;
    const minor = computeReadiness(spec([question('q', 'minor')])).score;
    expect(blocking).toBeLessThan(important);
    expect(important).toBeLessThan(minor);
  });
});
