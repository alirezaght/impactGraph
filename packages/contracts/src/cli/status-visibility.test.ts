import { describe, expect, it } from 'vitest';

import { indexWarningReportSchema } from './index-health.js';
import { cliStatusOutputSchema, cliVersionOutputSchema } from './outputs.js';
import { repositoryIndexStateSchema } from './repository-state.js';

// Dogfooding item 9 — the tool's own operational state is visible on the status surface:
// index freshness, categorized warnings, ignored source, roster limitations, and the server
// version. All additive v1: a v1 reader that ignores the new optional fields still validates.

const minimalStatus = {
  schemaVersion: 1,
  command: 'status',
  initialized: true,
  indexed: false,
};

const freshness = {
  state: 'behind-head',
  stale: true,
  reasons: ['The index was built at commit aaaa but HEAD is now bbbb.'],
  indexedSnapshotId: 'snap-1',
  indexedAt: '2026-08-05T10:00:00.000Z',
  currentCommitSha: 'bbbb',
  recommendedAction: 'Run `impactgraph index` and re-run the analysis.',
};

const indexWarnings = {
  totalCount: 38_412,
  coverageLosingCount: 2,
  affectsPredictedArea: false,
  groups: [
    {
      category: 'parse-failure',
      count: 2,
      examplePaths: ['src/a.ts'],
      exampleMessage: 'parse error',
      affectsPredictedArea: false,
    },
  ],
  sampled: true,
  omittedWarningCount: 38_362,
};

describe('status output visibility (additive v1)', () => {
  it('still accepts the bare v1 document', () => {
    expect(cliStatusOutputSchema.safeParse(minimalStatus).success).toBe(true);
  });

  it('accepts freshness, indexWarnings, ignoredCount, limitations and server', () => {
    const parsed = cliStatusOutputSchema.safeParse({
      ...minimalStatus,
      indexed: true,
      freshness,
      indexWarnings,
      ignoredCount: 12_000,
      limitations: ['Only this repository was analyzed; no related repositories are registered.'],
      server: { name: 'impactgraph', version: '0.0.0' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown keys in the new blocks', () => {
    expect(
      cliStatusOutputSchema.safeParse({
        ...minimalStatus,
        server: { name: 'impactgraph', version: '0.0.0', buildHash: 'invented' },
      }).success,
    ).toBe(false);
    expect(
      cliStatusOutputSchema.safeParse({ ...minimalStatus, freshness: { ...freshness, extra: 1 } })
        .success,
    ).toBe(false);
  });

  it('rejects an invented freshness state and a negative ignoredCount', () => {
    expect(
      cliStatusOutputSchema.safeParse({
        ...minimalStatus,
        freshness: { ...freshness, state: 'probably-fine' },
      }).success,
    ).toBe(false);
    expect(cliStatusOutputSchema.safeParse({ ...minimalStatus, ignoredCount: -1 }).success).toBe(
      false,
    );
  });
});

describe('index warning report sampling marker (additive v1)', () => {
  it('accepts the report with and without the sampling fields', () => {
    expect(indexWarningReportSchema.safeParse(indexWarnings).success).toBe(true);
    const { sampled, omittedWarningCount, ...unsampled } = indexWarnings;
    expect(sampled).toBe(true);
    expect(omittedWarningCount).toBe(38_362);
    expect(indexWarningReportSchema.safeParse(unsampled).success).toBe(true);
  });

  it('rejects a negative omission count', () => {
    expect(
      indexWarningReportSchema.safeParse({ ...indexWarnings, omittedWarningCount: -1 }).success,
    ).toBe(false);
  });
});

describe('repository index state reasonCode (additive v1)', () => {
  const state = {
    name: 'svc-a',
    path: 'svc-a',
    indexed: false,
    fileCount: 0,
    reason: 'registered but not in the current index — run index_workspace',
  };

  it('accepts every reason code and the code-less v1 shape', () => {
    expect(repositoryIndexStateSchema.safeParse(state).success).toBe(true);
    for (const reasonCode of ['not-indexed', 'disabled', 'path-missing', 'path-outside-root']) {
      expect(repositoryIndexStateSchema.safeParse({ ...state, reasonCode }).success).toBe(true);
    }
  });

  it('rejects an invented reason code', () => {
    expect(
      repositoryIndexStateSchema.safeParse({ ...state, reasonCode: 'gone-fishing' }).success,
    ).toBe(false);
  });
});

describe('version output', () => {
  it('accepts the version document and rejects invented build metadata', () => {
    expect(
      cliVersionOutputSchema.safeParse({
        schemaVersion: 1,
        command: 'version',
        name: 'impactgraph',
        version: '0.0.0',
      }).success,
    ).toBe(true);
    expect(
      cliVersionOutputSchema.safeParse({
        schemaVersion: 1,
        command: 'version',
        name: 'impactgraph',
        version: '0.0.0',
        buildDate: 'invented',
      }).success,
    ).toBe(false);
  });
});
