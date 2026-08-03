import { describe, expect, it } from 'vitest';

import { inferChange, obligationFor } from './change-kind.js';

describe('inferChange reads the predicted change from explicit wording', () => {
  const cases: readonly [string, string, string][] = [
    [
      'DealRepository must expose a count method returning the number of stored deals.',
      'add-api',
      'additive',
    ],
    ['The service must add a bulk import endpoint.', 'add-api', 'additive'],
    [
      '`createRepository` must take a connection string argument.',
      'change-api',
      'potentially-breaking',
    ],
    ['The search signature must accept a filters object.', 'change-api', 'potentially-breaking'],
    ['The deprecated `findAll` method must be removed.', 'remove-api', 'breaking'],
    ['`getDeals` must be renamed to `listDeals`.', 'remove-api', 'breaking'],
    ['DealService must filter expired deals from search results.', 'change-behavior', 'unknown'],
    [
      'The response payload must include an expiry timestamp.',
      'change-data-shape',
      'potentially-breaking',
    ],
    ['The system must be fast.', 'unknown', 'unknown'],
  ];

  for (const [statement, kind, compatibility] of cases) {
    it(`reads "${statement.slice(0, 44)}…" as ${kind}`, () => {
      const change = inferChange(statement);

      expect(change.kind).toBe(kind);
      expect(change.compatibility).toBe(compatibility);
    });
  }

  it('prefers removal over the additive verb when a statement carries both', () => {
    const change = inferChange('The adapter must remove the legacy flag and add a replacement.');

    expect(change.kind).toBe('remove-api');
  });

  it('quotes the wording that produced the reading, so a promotion can be audited', () => {
    expect(inferChange('`createRepository` must take a connection string argument.').cue).toContain(
      'take a connection string argument',
    );
    expect(inferChange('The system must be fast.').cue).toBe('no explicit change verb');
  });
});

describe('obligationFor turns a change kind into what a reverse hop proves', () => {
  it('does not promote callers of an additive API change', () => {
    expect(obligationFor(inferChange('must expose a count method'), 'CALLS')).toBe('possible');
  });

  it('promotes callers when the signature changes', () => {
    expect(obligationFor(inferChange('must take a connection string argument'), 'CALLS')).toBe(
      'likely',
    );
  });

  it('promotes callers when an API is removed or renamed', () => {
    expect(obligationFor(inferChange('must be renamed to listDeals'), 'CALLS')).toBe('likely');
  });

  it('keeps callers at possible for a behaviour-only change', () => {
    expect(obligationFor(inferChange('must filter expired deals'), 'CALLS')).toBe('possible');
  });

  it('keeps importers weaker than callers at the same change kind', () => {
    const signatureChange = inferChange('must take a connection string argument');

    expect(obligationFor(signatureChange, 'CALLS')).toBe('likely');
    // An import proves the module was pulled in, not that the changed symbol is referenced.
    expect(obligationFor(signatureChange, 'IMPORTS')).toBe('possible');
    expect(obligationFor(signatureChange, 'USES')).toBe('possible');
  });

  it('promotes importers only when removal breaks the import itself', () => {
    expect(obligationFor(inferChange('must be removed'), 'IMPORTS')).toBe('likely');
  });

  it('falls back to possible when the change kind is unknown', () => {
    expect(obligationFor(inferChange('must be fast'), 'CALLS')).toBe('possible');
    expect(obligationFor(inferChange('must be fast'), 'IMPORTS')).toBe('possible');
  });
});
