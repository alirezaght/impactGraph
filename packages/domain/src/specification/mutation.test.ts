import { describe, expect, it } from 'vitest';

import {
  confirmRequirement,
  dismissOpenQuestion,
  editRequirementStatement,
  rejectRequirement,
} from './mutation.js';
import { stableRequirementId } from './requirement.js';
import { createSpecification } from './specification.js';
import { isAnalysisStale } from './staleness.js';

import type { Specification } from './specification.js';

const STATEMENT = 'Expired deals must be hidden from search.';
const REQUIREMENT_ID = stableRequirementId(STATEMENT);
const AT = '2026-08-01T11:00:00.000Z';

const spec = (): Specification => {
  const result = createSpecification({
    id: 'spec-1',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: `# Deal visibility\n${STATEMENT}`,
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    requirements: [
      {
        id: REQUIREMENT_ID,
        statement: STATEMENT,
        type: 'functional',
        concepts: ['deal'],
        actors: [],
        status: 'draft',
        sourceRange: { startOffset: 18, endOffset: 60 },
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [
      {
        id: 'q-1',
        question: 'Should already-indexed expired deals be purged?',
        reason: 'purge job vs. query-time filter diverge',
        affectedRequirementIds: [REQUIREMENT_ID],
        severity: 'blocking',
        status: 'open',
      },
    ],
    decisions: [],
  });
  if (!result.ok) {
    throw new Error('fixture invalid');
  }
  return result.value;
};

describe('requirement status transitions (Story 5.4, PRD §11.1, §40.2)', () => {
  it('confirm: draft → confirmed at version N+1; version N untouched', () => {
    const before = spec();
    const confirmed = confirmRequirement(before, REQUIREMENT_ID, AT);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.value.version).toBe(2);
    expect(confirmed.value.updatedAt).toBe(AT);
    expect(confirmed.value.requirements[0]?.status).toBe('confirmed');
    expect(before.version).toBe(1);
    expect(before.requirements[0]?.status).toBe('draft');
  });

  it('reject: draft → rejected; the requirement record is preserved, not removed', () => {
    const rejected = rejectRequirement(spec(), REQUIREMENT_ID, AT);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) {
      return;
    }
    expect(rejected.value.requirements).toHaveLength(1);
    expect(rejected.value.requirements[0]?.status).toBe('rejected');
    expect(rejected.value.version).toBe(2);
  });

  it('unknown requirement ids are a typed error, not a throw', () => {
    expect(confirmRequirement(spec(), 'ghost', AT).ok).toBe(false);
    expect(rejectRequirement(spec(), 'ghost', AT).ok).toBe(false);
    expect(editRequirementStatement(spec(), 'ghost', 'x', AT).ok).toBe(false);
  });
});

describe('requirement statement edits (Story 5.4)', () => {
  it('keeps the ORIGINAL requirement id so impact links survive the edit', () => {
    const edited = editRequirementStatement(
      spec(),
      REQUIREMENT_ID,
      'Expired deals must be filtered from search at query time.',
      AT,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) {
      return;
    }
    const requirement = edited.value.requirements[0];
    expect(requirement?.id).toBe(REQUIREMENT_ID);
    expect(requirement?.id).not.toBe(
      stableRequirementId('Expired deals must be filtered from search at query time.'),
    );
    expect(requirement?.statement).toBe(
      'Expired deals must be filtered from search at query time.',
    );
    expect(edited.value.version).toBe(2);
  });

  it('preserves rawText verbatim, sourceRange, and status across the edit', () => {
    const before = spec();
    const edited = editRequirementStatement(before, REQUIREMENT_ID, 'New statement.', AT);
    expect(edited.ok).toBe(true);
    if (!edited.ok) {
      return;
    }
    expect(edited.value.rawText).toBe(before.rawText);
    expect(edited.value.requirements[0]?.sourceRange).toEqual({ startOffset: 18, endOffset: 60 });
    expect(edited.value.requirements[0]?.status).toBe('draft');
  });

  it('rejects blank statements', () => {
    expect(editRequirementStatement(spec(), REQUIREMENT_ID, '   ', AT).ok).toBe(false);
  });
});

describe('open-question dismissal (Story 5.4, PRD §11.2)', () => {
  it('dismiss: open → dismissed at version N+1; the question text is preserved', () => {
    const before = spec();
    const dismissed = dismissOpenQuestion(before, 'q-1', AT);
    expect(dismissed.ok).toBe(true);
    if (!dismissed.ok) {
      return;
    }
    expect(dismissed.value.version).toBe(2);
    expect(dismissed.value.openQuestions).toHaveLength(1);
    expect(dismissed.value.openQuestions[0]?.status).toBe('dismissed');
    expect(dismissed.value.openQuestions[0]?.question).toBe(before.openQuestions[0]?.question);
    expect(before.openQuestions[0]?.status).toBe('open');
  });

  it('unknown question ids are a typed error', () => {
    expect(dismissOpenQuestion(spec(), 'ghost', AT).ok).toBe(false);
  });
});

describe('analysis staleness (Story 5.4 — derived, never written)', () => {
  it('an analysis built from an older spec version is stale', () => {
    expect(isAnalysisStale({ specificationVersion: 1 }, 2)).toBe(true);
    expect(isAnalysisStale({ specificationVersion: 1 }, 1)).toBe(false);
    expect(isAnalysisStale({ specificationVersion: 2 }, 1)).toBe(false);
  });

  it('every mutation makes prior analyses stale by version comparison alone', () => {
    const before = spec();
    const analysisRef = { specificationVersion: before.version };
    const mutated = confirmRequirement(before, REQUIREMENT_ID, AT);
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) {
      return;
    }
    expect(isAnalysisStale(analysisRef, mutated.value.version)).toBe(true);
    expect(isAnalysisStale(analysisRef, before.version)).toBe(false);
  });
});
