import { describe, expect, it } from 'vitest';

import { parseSpecification, serializeSpecification } from '../serialization/specification-json.js';

import { intentOf, REQUIREMENT_INTENTS, requirementIssues } from './requirement.js';
import { createSpecification } from './specification.js';

import type { Requirement } from './requirement.js';

// New product direction: specifications routinely say "the send job must not change behavior".
// That is a requirement — it establishes a REGRESSION BOUNDARY — and it is the exact opposite of
// a change request. `type` says what subject matter, `priority` says how strongly, `origin` says
// where it came from; none of them could say WHICH DIRECTION. That is what `intent` is for.

const requirement = (overrides: Partial<Requirement> = {}): Requirement => ({
  id: 'req-1',
  statement: 'The send job must not change behavior.',
  type: 'functional',
  concepts: ['send job'],
  actors: [],
  status: 'draft',
  ...overrides,
});

describe('requirement intent axis', () => {
  it('offers exactly the two directions a requirement can point in', () => {
    expect(REQUIREMENT_INTENTS).toStrictEqual(['change', 'preserve']);
  });

  it('defaults to change, so every requirement stored before the axis existed keeps its meaning', () => {
    expect(intentOf(requirement())).toBe('change');
  });

  it('reads an explicit preserve intent', () => {
    expect(intentOf(requirement({ intent: 'preserve' }))).toBe('preserve');
  });

  it('rejects an intent outside the vocabulary', () => {
    const issues = requirementIssues(
      requirement({ intent: 'maintain' as never }),
      'requirements[0]',
    );
    expect(issues.map((issue) => issue.path)).toContain('requirements[0].intent');
  });

  it('accepts a valid intent without complaint', () => {
    expect(requirementIssues(requirement({ intent: 'preserve' }), 'requirements[0]')).toStrictEqual(
      [],
    );
  });
});

describe('intent survives the JSON round-trip', () => {
  it('reads back the preserve intent it wrote', () => {
    const specification = createSpecification({
      id: 'spec-1',
      sourceType: 'pasted',
      version: 1,
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      title: 'Digest',
      rawText: 'The send job must not change behavior.',
      requirements: [requirement({ intent: 'preserve' })],
      actors: [],
      constraints: [],
      openQuestions: [],
      decisions: [],
    });
    expect(specification.ok).toBe(true);
    if (!specification.ok) {
      return;
    }
    const json: unknown = JSON.parse(JSON.stringify(serializeSpecification(specification.value)));
    const restored = parseSpecification(json);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(intentOf(restored.value.requirements[0] as Requirement)).toBe('preserve');
  });

  it('reads a document written before the axis existed as change intent', () => {
    const json = {
      schemaVersion: 1,
      id: 'spec-1',
      sourceType: 'pasted',
      version: 1,
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      title: 'Digest',
      rawText: 'Add a flag.',
      requirements: [
        {
          id: 'req-1',
          statement: 'Add a flag.',
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
    };
    const restored = parseSpecification(json);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.value.requirements[0]?.intent).toBeUndefined();
    expect(intentOf(restored.value.requirements[0] as Requirement)).toBe('change');
  });
});
