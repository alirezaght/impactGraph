import { createEvidenceRecord } from '@impactgraph/domain';
import { serializeFragment } from '@impactgraph/language-adapters';
import { createFakeIndexStore } from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { searchLiteralsInStore } from './literal-search.js';

import type { IndexStorePort } from '@impactgraph/application';
import type { CallFact, DecoratorFact, GraphFragment } from '@impactgraph/language-adapters';

// search_literals over the fragment cache: the "where else does `= ANY(:ids)` appear, and how is
// it handled there?" question — answerable because SQL passed to query APIs survives as string
// arguments of call facts (TS/Python) and decorator facts (Java @Query).

const evidence = (id: string, filePath: string, startLine: number) => {
  const created = createEvidenceRecord({
    id,
    kind: 'call-site',
    source: {
      kind: 'file',
      filePath,
      range: { startLine, startColumn: 1, endLine: startLine, endColumn: 60 },
    },
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-14T10:00:00.000Z',
  });
  if (!created.ok) {
    throw new Error(`bad fixture evidence: ${id}`);
  }
  return created.value;
};

const fragment = (input: {
  callFacts?: CallFact[];
  decorators?: DecoratorFact[];
  evidence?: ReturnType<typeof evidence>[];
}): GraphFragment => ({
  nodes: [],
  edges: [],
  evidence: input.evidence ?? [],
  imports: [],
  symbolReferences: [],
  decorators: input.decorators ?? [],
  callFacts: input.callFacts ?? [],
  exportsByFile: {},
  warnings: [],
});

const LONG_SQL = `SELECT * FROM items WHERE id = ANY(:ids) AND ${'x'.repeat(300)}`;

const buildStore = (): IndexStorePort =>
  createFakeIndexStore({
    snapshotId: 'snap-1',
    nodes: [],
    edges: [],
    fragmentPayloads: new Map([
      [
        'src/repository.py',
        serializeFragment(
          fragment({
            callFacts: [
              {
                filePath: 'src/repository.py',
                receiverName: 'session',
                calleeName: 'execute',
                stringArguments: ['DELETE FROM items WHERE id = ANY(:ids)'],
                identifierArguments: [],
                evidenceId: 'ev-py-1',
              },
              {
                filePath: 'src/repository.py',
                calleeName: 'include_router',
                stringArguments: [],
                identifierArguments: ['router'],
                keywordStringArguments: { prefix: '/deals' },
                evidenceId: 'ev-py-2',
              },
            ],
            evidence: [
              evidence('ev-py-1', 'src/repository.py', 40),
              evidence('ev-py-2', 'src/repository.py', 55),
            ],
          }),
        ),
      ],
      [
        'src/ItemRepository.java',
        serializeFragment(
          fragment({
            decorators: [
              {
                targetNodeId: 'sym:find-by-ids',
                decoratorName: 'Query',
                stringArguments: ['SELECT i FROM Item i WHERE i.id = ANY(:ids)'],
                identifierLists: {},
                filePath: 'src/ItemRepository.java',
                evidenceId: 'ev-java-1',
              },
            ],
            evidence: [evidence('ev-java-1', 'src/ItemRepository.java', 21)],
          }),
        ),
      ],
      [
        'src/long.ts',
        serializeFragment(
          fragment({
            callFacts: [
              {
                filePath: 'src/long.ts',
                receiverName: 'db',
                calleeName: 'query',
                stringArguments: [LONG_SQL],
                identifierArguments: [],
                evidenceId: 'ev-ts-1',
              },
            ],
            evidence: [evidence('ev-ts-1', 'src/long.ts', 3)],
          }),
        ),
      ],
    ]),
  });

const search = async (pattern: string, options: { regex?: boolean; limit?: number } = {}) => {
  const result = await searchLiteralsInStore(buildStore(), { pattern, ...options });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe('searchLiterals', () => {
  it('finds an `= ANY(:ids)` fragment across call AND decorator arguments', async () => {
    const result = await search('= ANY(:ids)');
    expect(result.totalCount).toBe(3);
    expect(
      result.matches.map((match) => [match.filePath, match.ownerKind, match.ownerName]),
    ).toEqual([
      ['src/ItemRepository.java', 'decorator', 'Query'],
      ['src/long.ts', 'call', 'query'],
      ['src/repository.py', 'call', 'execute'],
    ]);
    const python = result.matches.find((match) => match.filePath === 'src/repository.py');
    expect(python?.receiver).toBe('session');
    expect(python?.line).toBe(40);
    expect(python?.truncated).toBe(false);
  });

  it('searches keyword string arguments too', async () => {
    const result = await search('/deals');
    expect(result.totalCount).toBe(1);
    expect(result.matches[0]?.ownerName).toBe('include_router');
  });

  it('respects the limit and reports the pre-limit total', async () => {
    const result = await search('= ANY(:ids)', { limit: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.totalCount).toBe(3);
  });

  it('truncates long literals to 200 chars and marks the truncation', async () => {
    const result = await search('= ANY(:ids)');
    const long = result.matches.find((match) => match.filePath === 'src/long.ts');
    expect(long?.truncated).toBe(true);
    expect(long?.literal).toHaveLength(200);
    expect(LONG_SQL.startsWith(long?.literal ?? '')).toBe(true);
  });

  it('supports regex matching when asked', async () => {
    const result = await search('ANY\\(:\\w+\\)', { regex: true });
    expect(result.matchMode).toBe('regex');
    expect(result.totalCount).toBe(3);
  });

  it('an invalid regex is a typed configuration error, never a crash', async () => {
    const result = await searchLiteralsInStore(buildStore(), { pattern: '(', regex: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('configurationError');
      expect(result.error.message).toContain('invalid regular expression');
    }
  });

  it('every result states its scope: literal facts only, never full text', async () => {
    const result = await search('nothing-matches-this');
    expect(result.matches).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.snapshotId).toBe('snap-1');
    expect(result.scope).toContain('NOT a full-text search');
    expect(result.scope).toContain('snap-1');
    expect(result.filesSearched).toBe(3);
    expect(result.filesWithoutCachedFacts).toBe(0);
  });
});
