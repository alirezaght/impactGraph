import { describe, expect, it } from 'vitest';

import {
  createNextSpecificationVersion,
  createSpecification,
  diffSpecifications,
  parseSpecification,
  serializeSpecification,
  stableRequirementId,
} from '../index.js';

import type { Requirement, Specification } from '../index.js';

const requirement = (statement: string, overrides: Partial<Requirement> = {}): Requirement => ({
  id: stableRequirementId(statement),
  statement,
  type: 'functional',
  concepts: ['deal'],
  actors: ['M&A advisor'],
  status: 'draft',
  ...overrides,
});

const baseRequirement = requirement('Expired deals must be hidden from search.', {
  priority: 'must',
  sourceRange: { startOffset: 18, endOffset: 60 },
});

const baseQuestion = {
  id: 'q-1',
  question: 'Should already-indexed expired deals be purged?',
  reason: 'Interpretations diverge: purge job vs. query-time filter.',
  affectedRequirementIds: [stableRequirementId('Expired deals must be hidden from search.')],
  severity: 'blocking',
  status: 'open',
} as const;

const baseSpec: Specification = {
  id: 'spec-1',
  title: 'Deal visibility rules',
  sourceType: 'markdown',
  sourceReference: 'specs/deal-visibility.md',
  rawText: '# Deal visibility\nExpired deals must be hidden from search.',
  version: 1,
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
  requirements: [baseRequirement],
  actors: [{ id: 'actor-advisor', name: 'M&A advisor' }],
  constraints: [{ id: 'con-1', statement: 'No breaking API changes.' }],
  openQuestions: [baseQuestion],
  decisions: [],
};

describe('Specification model (PRD §11, Story 5.1)', () => {
  it('constructs a frozen, valid specification', () => {
    const result = createSpecification(baseSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.requirements)).toBe(true);
    }
  });

  it('rejects unknown types, statuses, severities, and blank statements', () => {
    expect(
      createSpecification({
        ...baseSpec,
        requirements: [requirement('x', { type: 'wish' as never })],
      }).ok,
    ).toBe(false);
    expect(
      createSpecification({
        ...baseSpec,
        requirements: [requirement(' ', {})],
      }).ok,
    ).toBe(false);
    expect(
      createSpecification({
        ...baseSpec,
        openQuestions: [{ ...baseQuestion, severity: 'huge' as never }],
      }).ok,
    ).toBe(false);
  });

  it('rejects questions referencing nonexistent requirements and unanswered answers', () => {
    expect(
      createSpecification({
        ...baseSpec,
        openQuestions: [{ ...baseQuestion, affectedRequirementIds: ['ghost'] }],
      }).ok,
    ).toBe(false);
    expect(
      createSpecification({
        ...baseSpec,
        openQuestions: [{ ...baseQuestion, status: 'answered' }],
      }).ok,
    ).toBe(false);
  });

  it('rejects duplicate requirement ids', () => {
    const duplicated = requirement('Expired deals must be hidden from search.');
    expect(
      createSpecification({
        ...baseSpec,
        requirements: [duplicated, duplicated],
      }).ok,
    ).toBe(false);
  });

  it('stable requirement ids survive re-extraction and whitespace noise', () => {
    expect(stableRequirementId('Expired deals must be hidden from search.')).toBe(
      stableRequirementId('  expired   deals must be hidden from search. '),
    );
    expect(stableRequirementId('a')).not.toBe(stableRequirementId('b'));
  });
});

describe('versioning (PRD §40.2)', () => {
  it('saving creates version N+1; the previous version is untouched', () => {
    const v1 = createSpecification(baseSpec);
    expect(v1.ok).toBe(true);
    if (!v1.ok) {
      return;
    }
    const newRequirement = requirement('Expired deals stay visible on the detail page.');
    const v2 = createNextSpecificationVersion(
      v1.value,
      { requirements: [...v1.value.requirements, newRequirement] },
      '2026-07-31T11:00:00.000Z',
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) {
      return;
    }
    expect(v2.value.version).toBe(2);
    expect(v2.value.id).toBe(v1.value.id);
    expect(v2.value.createdAt).toBe(v1.value.createdAt);
    expect(v2.value.updatedAt).toBe('2026-07-31T11:00:00.000Z');
    expect(v1.value.version).toBe(1);
    expect(v1.value.requirements).toHaveLength(1);
  });

  it('diffs versions structurally', () => {
    const v1 = createSpecification(baseSpec);
    if (!v1.ok) {
      throw new Error('fixture invalid');
    }
    const kept = { ...baseRequirement, status: 'confirmed' as const };
    const added = requirement('Search must filter expired deals at query time.');
    const v2 = createNextSpecificationVersion(
      v1.value,
      {
        requirements: [kept, added],
        openQuestions: [
          {
            ...baseQuestion,
            status: 'answered',
            answer: 'Filter at query time; no purge job.',
          },
        ],
      },
      '2026-07-31T11:00:00.000Z',
    );
    if (!v2.ok) {
      throw new Error('v2 invalid');
    }
    const diff = diffSpecifications(v1.value, v2.value);
    expect(diff.addedRequirements.map((r) => r.id)).toEqual([added.id]);
    expect(diff.removedRequirements).toEqual([]);
    expect(diff.changedRequirements[0]?.changedFields).toEqual(['status']);
    expect(diff.resolvedQuestions.map((q) => q.id)).toEqual(['q-1']);
    expect(diff.rawTextChanged).toBe(false);
  });
});

describe('specification serialization', () => {
  it('round-trips an option-selection decision (optionId + decidedAt survive)', () => {
    const spec = createSpecification({
      ...baseSpec,
      decisions: [
        {
          id: 'adr-option-1',
          decision: 'Query-time filter — hide expired deals at read time.',
          reason: "user selected option 'option:abc' (AI-assisted) from analysis 'analysis-1'",
          optionId: 'option:abc',
          decidedAt: '2026-08-01T09:00:00.000Z',
        },
      ],
    });
    if (!spec.ok) {
      throw new Error('fixture invalid');
    }
    const parsed = parseSpecification(
      JSON.parse(JSON.stringify(serializeSpecification(spec.value))),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decisions[0]?.optionId).toBe('option:abc');
      expect(parsed.value.decisions[0]?.decidedAt).toBe('2026-08-01T09:00:00.000Z');
    }
  });

  it('round-trips exactly with a schemaVersion stamp', () => {
    const spec = createSpecification(baseSpec);
    if (!spec.ok) {
      throw new Error('fixture invalid');
    }
    const json = serializeSpecification(spec.value);
    expect(json.schemaVersion).toBe(1);
    const parsed = parseSpecification(JSON.parse(JSON.stringify(json)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(spec.value);
    }
  });

  it('round-trips a prose-modal requirement with its extraction confidence', () => {
    const spec = createSpecification({
      ...baseSpec,
      openQuestions: [],
      requirements: [
        requirement('The engine must stop ranking lexical matches first.', {
          origin: 'prose-modal',
          extractionConfidence: 0.8,
        }),
      ],
      extractionQuality: {
        strategy: 'prose-modal',
        structuredRequirementCount: 0,
        proseRequirementCount: 1,
        uncertainStatementCount: 2,
        recognizedSections: ['Goals'],
        provisional: false,
        warnings: [],
      },
    });
    if (!spec.ok) {
      throw new Error('fixture invalid');
    }
    const parsed = parseSpecification(
      JSON.parse(JSON.stringify(serializeSpecification(spec.value))),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.requirements[0]?.origin).toBe('prose-modal');
      expect(parsed.value.requirements[0]?.extractionConfidence).toBe(0.8);
      expect(parsed.value.extractionQuality?.uncertainStatementCount).toBe(2);
      expect(parsed.value).toEqual(spec.value);
    }
  });

  it('rejects an extraction confidence outside [0, 1]', () => {
    const result = createSpecification({
      ...baseSpec,
      openQuestions: [],
      requirements: [
        requirement('The engine must stop ranking lexical matches first.', {
          origin: 'prose-modal',
          extractionConfidence: 1.5,
        }),
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const spec = createSpecification(baseSpec);
    if (!spec.ok) {
      throw new Error('fixture invalid');
    }
    const json = serializeSpecification(spec.value);
    expect(parseSpecification({ ...json, schemaVersion: 9 }).ok).toBe(false);
    expect(parseSpecification({ ...json, version: 0 }).ok).toBe(false);
    expect(parseSpecification({ ...json, requirements: 'none' }).ok).toBe(false);
  });
});
