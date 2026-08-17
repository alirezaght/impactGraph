import { describe, expect, it } from 'vitest';

import { changeExpectationFor } from './change-expectation.js';

describe('changeExpectationFor (ADR-0022)', () => {
  it('reads explicit reuse wording as reuse-unchanged', () => {
    const cue = changeExpectationFor('Reuse the existing DigestRenderer without modification.', [
      'DigestRenderer',
    ]);

    expect(cue?.expectation).toBe('reuse-unchanged');
    expect(cue?.cue.toLowerCase()).toContain('reuse');
  });

  it('reads verification wording as verify-only', () => {
    const cue = changeExpectationFor('Verify that AlertPolicy already excludes expired deals.', [
      'AlertPolicy',
    ]);

    expect(cue?.expectation).toBe('verify-only');
  });

  it('matches a path subject by its basename', () => {
    const cue = changeExpectationFor('No changes to src/render/digest.ts are needed.', [
      'digest.ts',
    ]);

    expect(cue?.expectation).toBe('reuse-unchanged');
  });

  it('does not mark a component the reuse clause does not name', () => {
    const cue = changeExpectationFor(
      'Reuse the existing DigestRenderer, and extend AlertPolicy with a new rule.',
      ['AlertPolicy'],
    );

    expect(cue).toBeUndefined();
  });

  it('says nothing when the statement is an ordinary change requirement', () => {
    expect(changeExpectationFor('Add a digest preview endpoint.', ['digest'])).toBeUndefined();
  });

  it('ignores concepts too short to identify anything', () => {
    expect(changeExpectationFor('Reuse the existing db.', ['db'])).toBeUndefined();
  });
});
