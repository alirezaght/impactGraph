import { describe, expect, it } from 'vitest';

import { classifyStatement } from './prose-admission.js';
import { roleForHeading } from './spec-sections.js';
import { structuredExtraction } from './structured-extractor.js';

/**
 * Preservation requirements — the regression boundary (new product direction, real evaluation).
 *
 * Real specifications say "The send job must not change behavior", "Existing lookup behaviour
 * remains unchanged", "Deduplication behaviour must remain unchanged". Those are requirements: they
 * name what the change must NOT break. Before this, each of them was read as one of three wrong
 * things — a positive change requirement (because "must" fired), an unmatched concept, or nothing
 * at all (because the heading was not in the vocabulary). None of them is a non-goal: a non-goal
 * removes a component from the analysis; a guard keeps it in and demands no diff.
 */

const GUARDED_SPEC = `# Weekly digest

## Requirements

- Add a \`digestSchedule\` config key so operators can pick the send day.

## Explicitly unchanged

- The send job must not change behavior.
- Existing lookup behaviour remains unchanged.

## Non-goals

- No backfill of previously missed editions.
`;

describe('section vocabulary — preservation headings', () => {
  it.each([
    'Explicitly unchanged',
    'Unchanged behaviour',
    'Unchanged behavior',
    'Must remain unchanged',
    'Regression boundary',
    'Regression guards',
    'Backwards compatibility',
    'No behaviour change',
    'Preserved behaviour',
  ])("maps '%s' to preservation", (heading) => {
    expect(roleForHeading(heading)).toBe('preservation');
  });

  it('stops reading "Unchanged behaviour" as a requirements heading', () => {
    // The regression this role exists to fix: `behaviou?rs?` in the requirements rule turned an
    // explicitly-unchanged section into positive change predictions — the inverted meaning.
    expect(roleForHeading('Unchanged behaviour')).not.toBe('requirements');
  });

  it('leaves the non-goals vocabulary alone', () => {
    expect(roleForHeading('Non-goals')).toBe('non-goals');
    expect(roleForHeading('Out of scope')).toBe('non-goals');
    expect(roleForHeading('Explicitly excluded')).toBe('non-goals');
  });

  it('leaves the constraints vocabulary alone', () => {
    expect(roleForHeading('Invariants')).toBe('constraints');
    expect(roleForHeading('Assumptions')).toBe('constraints');
  });
});

describe('structuredExtraction — an Explicitly unchanged section', () => {
  const extraction = structuredExtraction(GUARDED_SPEC);
  const guards = extraction.requirements.filter((draft) => draft.intent === 'preserve');

  it('turns both protected surfaces into preserve-intent requirements', () => {
    expect(guards.map((draft) => draft.statement)).toStrictEqual([
      'The send job must not change behavior.',
      'Existing lookup behaviour remains unchanged.',
    ]);
  });

  it('does not drop them, and does not read them as change requirements', () => {
    const changes = extraction.requirements.filter((draft) => draft.intent !== 'preserve');
    expect(changes.map((draft) => draft.statement)).toStrictEqual([
      'Add a `digestSchedule` config key so operators can pick the send day.',
    ]);
  });

  it('does not record them as non-goals', () => {
    const nonGoals = (extraction.notes ?? []).filter((note) => note.kind === 'non-goal');
    expect(nonGoals.map((note) => note.statement)).toStrictEqual([
      'No backfill of previously missed editions.',
    ]);
  });

  it('keeps the real non-goal a non-goal, never a guard', () => {
    expect(extraction.requirements.some((draft) => draft.statement.includes('No backfill'))).toBe(
      false,
    );
  });

  it('recognizes the preservation section, so nothing about it is silent', () => {
    expect(extraction.quality?.recognizedSections).toContain('Explicitly unchanged');
  });
});

describe('structuredExtraction — section role outranks wording', () => {
  it('keeps a preservation-worded bullet inside Non-goals a non-goal', () => {
    const extraction = structuredExtraction(
      '## Non-goals\n\n- Existing send behaviour must remain unchanged.\n',
    );
    expect(extraction.requirements).toStrictEqual([]);
    expect((extraction.notes ?? []).map((note) => note.kind)).toContain('non-goal');
  });
});

describe('prose classifier — negated preservation', () => {
  it.each([
    'The send job must not change behavior.',
    'The send job must remain unchanged.',
    'Existing lookup behaviour remains unchanged.',
    'Deduplication behaviour must remain unchanged.',
    'The `digestJob` must continue to send one email per edition.',
    'The `lookupCache` should not be affected by this change.',
    'The scheduler stays unchanged.',
    'No behaviour change to the `sendJob`.',
    'Existing `dedupKey` handling continues to apply.',
  ])("reads '%s' as preservation", (statement) => {
    expect(classifyStatement(statement)).toBe('preservation');
  });

  it.each([
    'The digest must not send duplicate emails to a recipient.',
    'Operators must be able to change the send day.',
    'Add a `digestSchedule` config key.',
    'The renderer must emit one block per edition.',
  ])("still reads '%s' as a change requirement", (statement) => {
    expect(classifyStatement(statement)).toBe('requirement');
  });

  it('classifies a vague boundary separately from a concrete guard', () => {
    expect(classifyStatement('Nothing else should change.')).toBe('vague-preservation');
  });
});

describe('structuredExtraction — prose specification with a guard', () => {
  const PROSE_SPEC = [
    'The weekly digest currently sends on Mondays only.',
    'Operators must be able to configure the send day through a new config key.',
    'The send job must not change behavior.',
  ].join('\n\n');
  const extraction = structuredExtraction(PROSE_SPEC);

  it('admits the guard as a preserve-intent requirement', () => {
    const guards = extraction.requirements.filter((draft) => draft.intent === 'preserve');
    expect(guards.map((draft) => draft.statement)).toStrictEqual([
      'The send job must not change behavior.',
    ]);
  });

  it('keeps the positive requirement pointing at change', () => {
    const changes = extraction.requirements.filter((draft) => draft.intent !== 'preserve');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.statement).toContain('configure the send day');
  });

  it('does not turn the guard into an open question', () => {
    expect(
      extraction.openQuestions.some((question) =>
        question.question.includes('must not change behavior'),
      ),
    ).toBe(false);
  });
});

describe('the forcing function — a boundary with no named surface', () => {
  const VAGUE_SPEC = [
    'Operators must be able to configure the send day through a new config key.',
    'Nothing else should change.',
  ].join('\n\n');
  const extraction = structuredExtraction(VAGUE_SPEC);

  it('invents no guard', () => {
    expect(extraction.requirements.some((draft) => draft.intent === 'preserve')).toBe(false);
    expect(extraction.requirements.some((draft) => draft.statement.includes('Nothing else'))).toBe(
      false,
    );
  });

  it('asks for an explicit regression boundary instead', () => {
    const asked = extraction.openQuestions.filter((question) =>
      question.question.includes('remain unchanged'),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.reason).toContain('names no surface');
    expect(asked[0]?.severity).toBe('important');
  });

  it('names the recommended remedy, so the author knows what to write', () => {
    const asked = extraction.openQuestions.find((question) =>
      question.question.includes('remain unchanged'),
    );
    expect(asked?.question).toContain('Explicitly unchanged');
  });
});

describe('the forcing function — inside a preservation section', () => {
  it('asks rather than guards when a protected bullet names nothing', () => {
    const extraction = structuredExtraction(
      '## Explicitly unchanged\n\n- Nothing else should change.\n- The `sendJob` must not change behavior.\n',
    );
    expect(extraction.requirements.map((draft) => draft.statement)).toStrictEqual([
      'The `sendJob` must not change behavior.',
    ]);
    expect(
      extraction.openQuestions.some((question) => question.question.includes('remain unchanged')),
    ).toBe(true);
  });
});
