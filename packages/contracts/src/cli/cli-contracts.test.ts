import { describe, expect, it } from 'vitest';

import {
  cliErrorOutputSchema,
  cliIndexOutputSchema,
  cliStatusOutputSchema,
  EXIT_CODE_NAMES,
  EXIT_CODES,
  workspaceConfigSchema,
} from '../index.js';

describe('exit codes (PRD §20)', () => {
  it('has exactly one code per §20 category plus success and internal error', () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      internalError: 1,
      warningsFound: 2,
      reviewDiscrepancies: 3,
      configurationError: 4,
      indexingFailure: 5,
      providerFailure: 6,
      unsupportedProject: 7,
    });
  });

  it('never reuses a code', () => {
    const values = EXIT_CODE_NAMES.map((name) => EXIT_CODES[name]);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('CLI output schemas', () => {
  const validStatus = {
    schemaVersion: 1,
    command: 'status',
    initialized: true,
    indexed: true,
    snapshot: {
      id: 'snap-1',
      branch: 'main',
      commitSha: 'abc123',
      dirtyWorkingTree: false,
      createdAt: '2026-07-31T10:00:00.000Z',
    },
    counts: { files: 8, nodes: 40, edges: 30 },
  };

  it('accepts valid documents and round-trips them', () => {
    expect(cliStatusOutputSchema.parse(validStatus)).toEqual(validStatus);
  });

  it('rejects unknown commands, versions, and extra keys', () => {
    expect(cliStatusOutputSchema.safeParse({ ...validStatus, command: 'stat' }).success).toBe(
      false,
    );
    expect(cliStatusOutputSchema.safeParse({ ...validStatus, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(cliStatusOutputSchema.safeParse({ ...validStatus, extra: true }).success).toBe(false);
  });

  it('index output requires non-negative counts', () => {
    const base = {
      schemaVersion: 1,
      command: 'index',
      snapshot: validStatus.snapshot,
      fileCount: 8,
      changedFileCount: 0,
      reusedFileCount: 8,
      ignoredCount: 2,
      nodeCount: 40,
      edgeCount: 30,
      warnings: [],
    };
    expect(cliIndexOutputSchema.safeParse(base).success).toBe(true);
    expect(cliIndexOutputSchema.safeParse({ ...base, nodeCount: -1 }).success).toBe(false);
  });

  it('error output categories match the exit-code names', () => {
    for (const name of EXIT_CODE_NAMES.filter((n) => n !== 'success')) {
      const doc = { schemaVersion: 1, error: { category: name, message: 'boom' } };
      expect(cliErrorOutputSchema.safeParse(doc).success).toBe(true);
    }
    expect(
      cliErrorOutputSchema.safeParse({
        schemaVersion: 1,
        error: { category: 'success', message: 'boom' },
      }).success,
    ).toBe(false);
  });
});

describe('workspace config schema (PRD §17)', () => {
  it('accepts the default and custom ignores; rejects unknown keys', () => {
    expect(workspaceConfigSchema.safeParse({ schemaVersion: 1 }).success).toBe(true);
    expect(
      workspaceConfigSchema.safeParse({ schemaVersion: 1, ignore: ['**/*.gen.ts'] }).success,
    ).toBe(true);
    expect(
      workspaceConfigSchema.safeParse({ schemaVersion: 1, unknownSetting: true }).success,
    ).toBe(false);
  });
});
