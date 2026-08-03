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

  it('reads construction wording as a changed creation contract', () => {
    for (const statement of [
      'The repository constructor must take a connection string.',
      'DealRepository must be instantiated with an explicit pool size.',
      'The container must register the provider before use.',
    ]) {
      expect(inferChange(statement).kind, statement).toBe('change-construction');
    }
  });

  it('reads configuration wording as a configuration change', () => {
    for (const statement of [
      'The `DATABASE_URL` environment key must be supplied by every deployment.',
      'The provider token must be read from configuration values.',
      'The repository must receive its connection settings from the composition layer.',
    ]) {
      expect(inferChange(statement).kind, statement).toBe('change-configuration');
    }
  });

  // The guard against over-reading: a method on a class that happens to be injected somewhere is
  // not a construction change, however constructor-adjacent the component is.
  it('does not read a plain method change as a construction change', () => {
    expect(inferChange('DealRepository must expose a count method.').kind).toBe('add-api');
    expect(inferChange('DealRepository must filter expired rows.').kind).toBe('change-behavior');
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

// INJECTS proves construction-time coupling: the consumer holds a reference it was handed, and does
// not read the dependency's internals. So creation and configuration changes reach it; behavioural
// ones do not. Paired against the CALLS table, which reasons about call sites instead.
describe('INJECTS obligations follow construction-time coupling', () => {
  const injects = (statement: string): string => obligationFor(inferChange(statement), 'INJECTS');

  it('promotes the injecting consumer when the creation contract changes', () => {
    expect(injects('The repository constructor must take a connection string.')).toBe('likely');
    expect(injects('The container must register the provider explicitly.')).toBe('likely');
  });

  it('promotes the injecting consumer when required configuration changes', () => {
    expect(injects('The `DATABASE_URL` environment key must be renamed.')).toBe('likely');
    expect(injects('The provider token must come from configuration values.')).toBe('likely');
  });

  it('promotes on removal and on an incompatible API change', () => {
    expect(injects('`findAll` must be removed.')).toBe('likely');
    expect(injects('`findAll` must accept a filters parameter.')).toBe('likely');
  });

  it('does NOT promote for an additive method on the injected dependency', () => {
    expect(injects('DealRepository must expose a count method.')).toBe('possible');
  });

  it('does NOT promote for a behaviour-only change to the injected dependency', () => {
    // Whoever constructed the repository is unaffected by what it does at run time.
    expect(injects('DealRepository must filter expired rows.')).toBe('possible');
  });

  it('does NOT promote when the change kind is unknown', () => {
    expect(injects('The repository must be fast.')).toBe('possible');
  });
});

describe('USES_UNKNOWN stays weak for every change kind', () => {
  // Tested synthetically at this layer on purpose: no adapter currently produces USES_UNKNOWN, the
  // fallback paths being unreachable, so an adapter fixture cannot constrain this. The rule still
  // has to hold for the day a handle-kind union grows.
  for (const statement of [
    'The repository constructor must take a connection string.',
    '`findAll` must be removed.',
    'The response payload must change.',
    'The `DATABASE_URL` environment key must be renamed.',
    'must expose a count method',
  ]) {
    it(`never promotes: "${statement.slice(0, 40)}…"`, () => {
      expect(obligationFor(inferChange(statement), 'USES_UNKNOWN')).toBe('possible');
    });
  }
});
