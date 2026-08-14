import { describe, expect, it } from 'vitest';

import { REFERENCE_KINDS, REFERENCE_TOOL_CONTRACTS } from './reference-tools.js';

// Contract tests for the structural reference tools. The honesty features — the per-record
// 'name-match' label, the required coverage/scope statements, the disambiguation candidates —
// are enforced HERE, so no implementation can quietly drop them.

const findReferences = REFERENCE_TOOL_CONTRACTS.find_references;
const searchLiterals = REFERENCE_TOOL_CONTRACTS.search_literals;

const coverage = {
  snapshotId: 'snap-1',
  searched: ['structural edges of the knowledge graph at snapshot snap-1'],
  knownLimits: ['member calls are matched by name only — the receiver type is not resolved'],
  filesSearched: 3,
  filesWithoutCachedFacts: 1,
};

const resolvedOutput = {
  query: 'ListingRepository',
  resolution: 'resolved' as const,
  resolved: { nodeId: 'sym:a', name: 'ListingRepository', type: 'interface', path: 'src/a.ts' },
  references: [
    {
      kind: 'implementations' as const,
      edgeType: 'IMPLEMENTS',
      direction: 'incoming' as const,
      counterparts: [
        {
          nodeId: 'sym:b',
          name: 'SqlListingRepository',
          type: 'class',
          path: 'src/b.ts',
          provenance: 'static-analysis',
        },
      ],
      totalCount: 1,
    },
  ],
  nameMatchedCallSites: [
    {
      basis: 'name-match' as const,
      filePath: 'src/c.py',
      calleeName: 'remove_item',
      receiver: 'store',
      line: 12,
      sampleArgument: 'item-1',
    },
  ],
  nameMatchedCallSiteTotal: 1,
  coverage,
};

describe('find_references contract', () => {
  it('accepts a plain query and rejects unknown keys and unknown kinds', () => {
    expect(findReferences.input.safeParse({ query: 'remove_item' }).success).toBe(true);
    expect(
      findReferences.input.safeParse({ query: 'x', kinds: ['callers', 'implementations'] }).success,
    ).toBe(true);
    expect(findReferences.input.safeParse({ query: 'x', kinds: ['owners'] }).success).toBe(false);
    expect(findReferences.input.safeParse({ query: 'x', extra: 1 }).success).toBe(false);
    expect(findReferences.input.safeParse({ query: '' }).success).toBe(false);
    // the kind vocabulary is closed and exported
    expect(REFERENCE_KINDS).toContain('implementations');
    expect(REFERENCE_KINDS).toContain('importers');
  });

  it('round-trips a resolved output and preserves every field', () => {
    const parsed = findReferences.output.safeParse(resolvedOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(resolvedOutput);
  });

  it('requires the coverage statement — an answer without scope does not parse', () => {
    const { coverage: dropped, ...withoutCoverage } = resolvedOutput;
    void dropped;
    expect(findReferences.output.safeParse(withoutCoverage).success).toBe(false);
    // empty knownLimits would claim the search had no limits — rejected
    expect(
      findReferences.output.safeParse({
        ...resolvedOutput,
        coverage: { ...coverage, knownLimits: [] },
      }).success,
    ).toBe(false);
  });

  it('call sites must carry the name-match label — an unlabeled site does not parse', () => {
    const unlabeled = {
      ...resolvedOutput,
      nameMatchedCallSites: [{ filePath: 'src/c.py', calleeName: 'remove_item' }],
    };
    expect(findReferences.output.safeParse(unlabeled).success).toBe(false);
    const mislabeled = {
      ...resolvedOutput,
      nameMatchedCallSites: [
        { basis: 'type-resolved', filePath: 'src/c.py', calleeName: 'remove_item' },
      ],
    };
    expect(findReferences.output.safeParse(mislabeled).success).toBe(false);
  });

  it('an ambiguous resolution parses with candidates and no resolved node', () => {
    const ambiguous = {
      query: 'Duplicate',
      resolution: 'ambiguous' as const,
      candidates: [
        { nodeId: 'sym:d1', name: 'Duplicate', type: 'class' },
        { nodeId: 'sym:d2', name: 'Duplicate', type: 'class' },
      ],
      references: [],
      nameMatchedCallSites: [],
      nameMatchedCallSiteTotal: 0,
      coverage,
    };
    expect(findReferences.output.safeParse(ambiguous).success).toBe(true);
  });

  it('rejects unknown output keys — the shape is closed on both ends', () => {
    expect(findReferences.output.safeParse({ ...resolvedOutput, guess: true }).success).toBe(false);
  });
});

describe('search_literals contract', () => {
  const output = {
    matches: [
      {
        filePath: 'src/repository.py',
        ownerKind: 'call' as const,
        ownerName: 'execute',
        receiver: 'session',
        literal: 'DELETE FROM items WHERE id = ANY(:ids)',
        truncated: false,
        line: 40,
      },
    ],
    totalCount: 1,
    matchMode: 'substring' as const,
    snapshotId: 'snap-1',
    scope:
      'string literals passed as call or decorator arguments at snapshot snap-1 — NOT a full-text search of file contents',
    filesSearched: 3,
    filesWithoutCachedFacts: 0,
  };

  it('accepts pattern-only input and rejects unknown keys', () => {
    expect(searchLiterals.input.safeParse({ pattern: '= ANY(:ids)' }).success).toBe(true);
    expect(searchLiterals.input.safeParse({ pattern: 'x', regex: true, limit: 10 }).success).toBe(
      true,
    );
    expect(searchLiterals.input.safeParse({ pattern: '' }).success).toBe(false);
    expect(searchLiterals.input.safeParse({ pattern: 'x', flags: 'i' }).success).toBe(false);
  });

  it('round-trips an output and requires the scope statement', () => {
    const parsed = searchLiterals.output.safeParse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(output);
    const { scope, ...withoutScope } = output;
    void scope;
    expect(searchLiterals.output.safeParse(withoutScope).success).toBe(false);
  });

  it('every match states where the literal was observed and whether it was truncated', () => {
    const bareMatch = { filePath: 'src/a.ts', ownerName: 'query', literal: 'x' };
    expect(searchLiterals.output.safeParse({ ...output, matches: [bareMatch] }).success).toBe(
      false,
    );
    expect(
      searchLiterals.output.safeParse({
        ...output,
        matches: [{ ...bareMatch, ownerKind: 'call', truncated: false }],
      }).success,
    ).toBe(true);
  });
});
