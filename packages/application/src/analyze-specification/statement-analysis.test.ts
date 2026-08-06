import { describe, expect, it } from 'vitest';

import { conceptsOf } from './statement-analysis.js';

describe('conceptsOf', () => {
  it('extracts identifier-shaped candidates', () => {
    const concepts = conceptsOf(
      'When `DealRepository` emits notification.nda_signature_request the CamelCaseHandler runs.',
    );
    expect(concepts).toContain('DealRepository');
    expect(concepts).toContain('notification.nda_signature_request');
    expect(concepts).toContain('CamelCaseHandler');
  });

  it('does not promote prose abbreviations from the dotted pattern', () => {
    const concepts = conceptsOf(
      'The service must retry idempotently, e.g. on timeout, i.e. safely.',
    );
    expect(concepts).not.toContain('e.g');
    expect(concepts).not.toContain('i.e');
  });

  it('does not promote version numbers', () => {
    expect(conceptsOf('Upgrade the runtime to `v1.2.3` before rollout.')).not.toContain('v1.2.3');
    expect(conceptsOf('Pin better-sqlite3 to 11.3.0 in the manifest.')).not.toContain('11.3.0');
  });

  it('does not promote backticked prose spans', () => {
    const concepts = conceptsOf(
      'Keep `the whole signature flow rewritten to support countersigning` out of scope.',
    );
    expect(concepts).toHaveLength(0);
  });

  it('keeps short backticked phrases and file names', () => {
    const concepts = conceptsOf('Show the `deal listing page` after `package.json` changes.');
    expect(concepts).toContain('deal listing page');
    expect(concepts).toContain('package.json');
  });

  it('rejects terms beyond the length bound', () => {
    const long = 'a'.repeat(81);
    expect(conceptsOf(`Handle \`${long}\` gracefully.`)).toHaveLength(0);
  });
});
