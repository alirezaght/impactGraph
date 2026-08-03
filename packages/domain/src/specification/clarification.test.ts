import { describe, expect, it } from 'vitest';

import {
  answerOpenQuestion,
  applyKnownClarifications,
  clarificationQuestionKey,
  createClarificationRecord,
} from './clarification.js';
import { createSpecification } from './specification.js';

import type { ClarificationRecord } from './clarification.js';
import type { Specification } from './specification.js';

const QUESTION_TEXT = 'Who owns the deal-updated event?';

const spec = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'T',
    sourceType: 'markdown',
    rawText: 'DealService must publish deal updates.',
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'DealService must publish deal updates.',
        type: 'integration',
        concepts: ['DealService'],
        actors: [],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [
      {
        id: 'q-1',
        question: QUESTION_TEXT,
        reason: 'two services could own it; the impact graphs diverge',
        affectedRequirementIds: ['req-1'],
        severity: 'blocking',
        status: 'open',
      },
    ],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('spec invalid');
  }
  return result.value;
};

const record = (overrides: Partial<ClarificationRecord> = {}): ClarificationRecord => ({
  id: 'clar-1',
  questionKey: clarificationQuestionKey(QUESTION_TEXT),
  question: QUESTION_TEXT,
  decision: 'DealService owns the event.',
  reason: 'existing publisher lives in DealService',
  specificationId: 'spec-1',
  specificationVersion: 1,
  relatedRequirementIds: ['req-1'],
  relatedNodeIds: [],
  relatedContexts: [],
  decidedAt: '2026-08-01T11:00:00.000Z',
  author: 'user',
  confidence: 1,
  manuallyConfirmed: true,
  ...overrides,
});

describe('clarification records (Story 15.5, PRD §C9)', () => {
  it('validates the §C9 envelope and derives the question key from the question text', () => {
    const created = createClarificationRecord(record());
    expect(created.ok).toBe(true);
    const forged = createClarificationRecord(record({ questionKey: 'clarification-forged' }));
    expect(forged.ok).toBe(false);
    const blank = createClarificationRecord(record({ decision: '  ' }));
    expect(blank.ok).toBe(false);
  });

  it('answering a question creates version N+1; version N is untouched (§40.2)', () => {
    const before = spec();
    const answered = answerOpenQuestion(
      before,
      'q-1',
      'DealService owns it.',
      '2026-08-01T11:00:00.000Z',
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) {
      return;
    }
    expect(answered.value.version).toBe(2);
    expect(answered.value.openQuestions[0]?.status).toBe('answered');
    expect(answered.value.openQuestions[0]?.answer).toBe('DealService owns it.');
    // history intact
    expect(before.version).toBe(1);
    expect(before.openQuestions[0]?.status).toBe('open');
  });

  it('rejects unknown question ids and empty answers', () => {
    expect(answerOpenQuestion(spec(), 'ghost', 'x', '2026-08-01T11:00:00.000Z').ok).toBe(false);
    expect(answerOpenQuestion(spec(), 'q-1', '   ', '2026-08-01T11:00:00.000Z').ok).toBe(false);
  });

  it('a recorded decision suppresses the same question in a later analysis (§C9)', () => {
    const applied = applyKnownClarifications(spec(), [record()]);
    expect(applied.suppressedQuestionIds).toEqual(['q-1']);
    expect(applied.specification.openQuestions[0]?.status).toBe('answered');
    expect(applied.specification.openQuestions[0]?.answer).toBe('DealService owns the event.');
  });

  it('an unrelated decision suppresses nothing', () => {
    const applied = applyKnownClarifications(spec(), [
      record({
        question: 'Different question entirely?',
        questionKey: clarificationQuestionKey('Different question entirely?'),
      }),
    ]);
    expect(applied.suppressedQuestionIds).toEqual([]);
    expect(applied.specification).toBe(spec1Identity(applied.specification));
  });
});

// identity helper so the no-op path is visibly "same object back"
const spec1Identity = (value: Specification): Specification => value;
