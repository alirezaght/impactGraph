import { describe, expect, it } from 'vitest';

import { buildRequiredActions } from './reports/required-actions.js';
import { isDisabledState, isNotIndexedState, isUnavailableState } from './repository-reasons.js';

import type { WorkspaceCoverageDto } from '@impactgraph/contracts';
import type { IndexFreshness } from '@impactgraph/domain';

// GAP 4 of dogfooding item 9: reason strings were the API. Every derivation now keys off the
// typed reasonCode; the exact wording of `reason` is presentation. These tests pin that a
// REWORDED reason string no longer changes behavior — and that code-less legacy payloads still
// derive the same actions through the string fallback.

const fresh: IndexFreshness = { state: 'current', stale: false, reasons: [] };
const adequate: WorkspaceCoverageDto = {
  status: 'adequate',
  reasons: [],
  repositories: { indexed: [], registeredButMissing: [], candidates: [] },
  affectedRequirementIds: [],
  affectedConcepts: [],
};

const state = (
  overrides: Partial<Parameters<typeof isNotIndexedState>[0]>,
): Parameters<typeof isNotIndexedState>[0] => ({
  name: 'svc-a',
  path: 'svc-a',
  indexed: false,
  fileCount: 0,
  ...overrides,
});

describe('typed repository reason predicates', () => {
  it('key off the reasonCode, not the wording', () => {
    const reworded = state({ reasonCode: 'not-indexed', reason: 'completely new sentence' });
    expect(isNotIndexedState(reworded)).toBe(true);
    expect(isUnavailableState(reworded)).toBe(false);
    expect(isDisabledState(state({ reasonCode: 'disabled', reason: 'switched off by you' }))).toBe(
      true,
    );
    expect(isUnavailableState(state({ reasonCode: 'path-missing', reason: 'poof, gone' }))).toBe(
      true,
    );
  });

  it('a reasonCode wins over a contradicting legacy wording', () => {
    // The code is authoritative: a 'path-missing' state is NOT re-indexable even when its
    // human sentence happens to contain the old marker phrase.
    const contradictory = state({
      reasonCode: 'path-missing',
      reason: 'not in the current index (path also missing)',
    });
    expect(isNotIndexedState(contradictory)).toBe(false);
    expect(isUnavailableState(contradictory)).toBe(true);
  });

  it('falls back to the legacy wording only when no code is present', () => {
    expect(
      isNotIndexedState(
        state({ reason: 'registered but not in the current index — run index_workspace' }),
      ),
    ).toBe(true);
    expect(isDisabledState(state({ reason: 'disabled in configuration' }))).toBe(true);
    expect(isUnavailableState(state({ reason: 'the declared path does not exist on disk' }))).toBe(
      true,
    );
  });
});

describe('required actions derive from reason codes', () => {
  it('derives the same actions when every reason sentence is reworded', () => {
    const actions = buildRequiredActions({
      coverage: adequate,
      freshness: fresh,
      context: {
        repositories: [
          { name: '(workspace root)', indexed: true, fileCount: 3 },
          state({ name: 'svc-a', reasonCode: 'not-indexed', reason: 'brand new wording' }),
          state({ name: 'ghost', reasonCode: 'path-missing', reason: 'also brand new wording' }),
          state({ name: 'off', reasonCode: 'disabled', reason: 'turned off, differently put' }),
        ],
        candidates: [],
        limitations: [],
      },
    });
    const kinds = actions.map((action) => action.action);
    expect(kinds).toEqual(['index-registered-repositories', 'register-missing-repositories']);
    expect(actions[0]?.repositories).toEqual(['svc-a']);
    expect(actions[1]?.repositories).toEqual(['ghost']);
  });

  it('a disabled member produces no action at all', () => {
    const actions = buildRequiredActions({
      coverage: adequate,
      freshness: fresh,
      context: {
        repositories: [state({ name: 'off', reasonCode: 'disabled', reason: 'any wording' })],
        candidates: [],
        limitations: [],
      },
    });
    expect(actions).toEqual([]);
  });
});
