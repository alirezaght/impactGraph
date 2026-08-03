import { describe, expect, it } from 'vitest';

import { createFallbackAdapter, createPrismaAdapter, createTypeScriptAdapter } from '../index.js';

import type { AnalysisContext, GitDiff, GraphChangeSet, RepositoryFile } from '../index.js';

// Golden tests for LanguageAdapter.analyzeDiff (PRD §24, §30, §42.3). Diffs are literal
// fixtures: the adapter contract takes a GitDiff value, so no real git repository is needed.

const BASE_SERVICE = [
  "import { BaseService } from './base-service';",
  '',
  'export class DealService {',
  '  public search(term: string): string {',
  '    return term;',
  '  }',
  '}',
  '',
  'export const LIMIT = 10;',
  '',
].join('\n');

const NEXT_SERVICE = [
  "import { BaseService } from './base-service';",
  "import { Logger } from './logger';",
  '',
  'export class DealService {',
  '  public search(term: string): string {',
  '    return term.trim();',
  '  }',
  '',
  '  public count(): number {',
  '    return 0;',
  '  }',
  '}',
  '',
].join('\n');

const SERVICE_PATH = 'src/deal-service.ts';

const file = (relativePath: string, content: string): RepositoryFile => ({
  relativePath,
  content,
});

const context = (
  files: readonly RepositoryFile[],
  previousFiles?: readonly RepositoryFile[],
): AnalysisContext => ({
  repositorySnapshotId: 'snap-review',
  analysisRunId: 'run-review',
  createdAt: '2026-08-02T09:00:00.000Z',
  files,
  ...(previousFiles === undefined ? {} : { previousFiles }),
});

/** Stable, human-diffable projection of a change set — the golden representation. */
const serialize = (changeSet: GraphChangeSet): string => {
  const lines: string[] = [];
  for (const change of changeSet.fileChanges) {
    const from = change.previousPath === undefined ? '' : ` from=${change.previousPath}`;
    lines.push(
      `file ${change.path} ${change.changeType}${from} symbolLevel=${String(change.symbolLevel)}`,
    );
    if (change.unverifiableReason !== undefined) {
      lines.push(`  unverifiable: ${change.unverifiableReason}`);
    }
    for (const symbol of change.symbolChanges) {
      lines.push(`  symbol ${symbol.kind} ${symbol.nodeType} ${symbol.symbolName}`);
    }
    for (const imported of change.importChanges) {
      lines.push(`  import ${imported.kind} ${imported.specifier}`);
    }
  }
  lines.push(`removedNodes: ${[...changeSet.removedNodeIds].sort().join(', ')}`);
  lines.push(`removedEdges: ${[...changeSet.removedEdgeIds].sort().join(', ')}`);
  lines.push(`removedFiles: ${[...changeSet.removedFilePaths].sort().join(', ')}`);
  lines.push(`invalidated: ${[...changeSet.invalidatedFilePaths].sort().join(', ')}`);
  return lines.join('\n');
};

const adapter = createTypeScriptAdapter();

describe('TypeScript adapter — analyzeDiff symbol-level goldens (Story 11.1)', () => {
  it('reports added, removed, and changed symbols plus import deltas for a modified file', async () => {
    const diff: GitDiff = { changedFiles: [{ path: SERVICE_PATH, changeType: 'modified' }] };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file(SERVICE_PATH, NEXT_SERVICE)], [file(SERVICE_PATH, BASE_SERVICE)]),
    );

    expect(serialize(changeSet)).toBe(
      [
        `file ${SERVICE_PATH} modified symbolLevel=true`,
        '  symbol added method DealService.count',
        '  symbol changed class DealService',
        '  symbol changed method DealService.search',
        '  symbol removed symbol LIMIT',
        '  import added ./logger',
        `removedNodes: symbol:${SERVICE_PATH}#LIMIT`,
        `removedEdges: contains:symbol:${SERVICE_PATH}#LIMIT`,
        'removedFiles: ',
        `invalidated: ${SERVICE_PATH}`,
      ].join('\n'),
    );
  });

  it('re-parses the NEW content into the fragment the caller re-applies', async () => {
    const diff: GitDiff = { changedFiles: [{ path: SERVICE_PATH, changeType: 'modified' }] };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file(SERVICE_PATH, NEXT_SERVICE)], [file(SERVICE_PATH, BASE_SERVICE)]),
    );

    expect(changeSet.fragment.nodes.map((node) => node.id).sort()).toEqual([
      `file:${SERVICE_PATH}`,
      `symbol:${SERVICE_PATH}#DealService`,
      `symbol:${SERVICE_PATH}#DealService.count`,
      `symbol:${SERVICE_PATH}#DealService.search`,
    ]);
    expect(changeSet.fragment.imports.map((reference) => reference.specifier).sort()).toEqual([
      './base-service',
      './logger',
    ]);
  });

  it('reports every symbol of an added file as added', async () => {
    const diff: GitDiff = { changedFiles: [{ path: SERVICE_PATH, changeType: 'added' }] };
    const changeSet = await adapter.analyzeDiff(diff, context([file(SERVICE_PATH, BASE_SERVICE)]));

    expect(serialize(changeSet)).toBe(
      [
        `file ${SERVICE_PATH} added symbolLevel=true`,
        '  symbol added class DealService',
        '  symbol added method DealService.search',
        '  symbol added symbol LIMIT',
        '  import added ./base-service',
        'removedNodes: ',
        'removedEdges: ',
        'removedFiles: ',
        `invalidated: ${SERVICE_PATH}`,
      ].join('\n'),
    );
  });

  it('removes a deleted file’s fragment wholesale', async () => {
    const diff: GitDiff = { changedFiles: [{ path: SERVICE_PATH, changeType: 'deleted' }] };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([], [file(SERVICE_PATH, BASE_SERVICE)]),
    );

    expect(changeSet.fragment.nodes).toEqual([]);
    expect(changeSet.removedFilePaths).toEqual([SERVICE_PATH]);
    expect([...changeSet.removedNodeIds].sort()).toEqual([
      `file:${SERVICE_PATH}`,
      `symbol:${SERVICE_PATH}#DealService`,
      `symbol:${SERVICE_PATH}#DealService.search`,
      `symbol:${SERVICE_PATH}#LIMIT`,
    ]);
    expect(changeSet.fileChanges[0]?.symbolChanges.map((change) => change.kind)).toEqual([
      'removed',
      'removed',
      'removed',
    ]);
  });

  it('treats a rename as ONE change — never a delete plus an add (§24)', async () => {
    const diff: GitDiff = {
      changedFiles: [
        { path: 'src/renamed-service.ts', changeType: 'renamed', previousPath: SERVICE_PATH },
      ],
    };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file('src/renamed-service.ts', BASE_SERVICE)], [file(SERVICE_PATH, BASE_SERVICE)]),
    );

    expect(changeSet.fileChanges).toHaveLength(1);
    expect(changeSet.fileChanges[0]?.changeType).toBe('renamed');
    expect(changeSet.fileChanges[0]?.previousPath).toBe(SERVICE_PATH);
    // Identical declarations at a new path: the symbols moved, none of them changed.
    expect(changeSet.fileChanges[0]?.symbolChanges).toEqual([]);
    expect(changeSet.fileChanges[0]?.importChanges).toEqual([]);
    expect(changeSet.removedFilePaths).toEqual([SERVICE_PATH]);
    expect(changeSet.fragment.nodes.some((node) => node.id === 'file:src/renamed-service.ts')).toBe(
      true,
    );
  });

  it('reports a rename that also edits the file as one change with symbol deltas', async () => {
    const diff: GitDiff = {
      changedFiles: [
        { path: 'src/renamed-service.ts', changeType: 'renamed', previousPath: SERVICE_PATH },
      ],
    };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file('src/renamed-service.ts', NEXT_SERVICE)], [file(SERVICE_PATH, BASE_SERVICE)]),
    );

    expect(changeSet.fileChanges).toHaveLength(1);
    expect(
      changeSet.fileChanges[0]?.symbolChanges.map(
        (change) => `${change.kind}:${change.symbolName}`,
      ),
    ).toEqual([
      'added:DealService.count',
      'changed:DealService',
      'changed:DealService.search',
      'removed:LIMIT',
    ]);
  });
});

describe('analyzeDiff — unverifiable and degraded cases (§24, §34)', () => {
  it('marks binary content unverifiable at symbol level instead of guessing', async () => {
    const diff: GitDiff = { changedFiles: [{ path: 'src/blob.ts', changeType: 'modified' }] };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file('src/blob.ts', `PK\u0000\u0000binary`)]),
    );

    expect(changeSet.fileChanges[0]?.symbolLevel).toBe(false);
    expect(changeSet.fileChanges[0]?.unverifiableReason).toContain('binary content');
    // File-level evidence survives: the file is reported, never silently dropped.
    expect(changeSet.fragment.nodes.map((node) => node.id)).toEqual(['file:src/blob.ts']);
  });

  it('marks files outside supportedExtensions unverifiable at symbol level', async () => {
    const diff: GitDiff = { changedFiles: [{ path: 'infra/main.tf', changeType: 'modified' }] };
    const changeSet = await adapter.analyzeDiff(
      diff,
      context([file('infra/main.tf', 'resource "google_cloud_run_service" "api" {}')]),
    );

    expect(changeSet.fileChanges[0]?.symbolLevel).toBe(false);
    expect(changeSet.fileChanges[0]?.unverifiableReason).toContain('not supported by adapter');
    expect(changeSet.fileChanges[0]?.symbolChanges).toEqual([]);
  });

  it('says so when no baseline content was supplied rather than inventing a comparison', async () => {
    const diff: GitDiff = { changedFiles: [{ path: SERVICE_PATH, changeType: 'modified' }] };
    const changeSet = await adapter.analyzeDiff(diff, context([file(SERVICE_PATH, NEXT_SERVICE)]));

    expect(changeSet.fileChanges[0]?.symbolLevel).toBe(false);
    expect(changeSet.fileChanges[0]?.unverifiableReason).toContain('baseline content');
    // The new facts are still produced so the graph can be refreshed.
    expect(changeSet.fragment.nodes.length).toBeGreaterThan(0);
  });

  it('records a warning for unparseable content and still analyses the rest of the diff', async () => {
    const diff: GitDiff = {
      changedFiles: [
        { path: 'src/evil.ts', changeType: 'modified' },
        { path: SERVICE_PATH, changeType: 'modified' },
      ],
    };
    const hostile = file('src/evil.ts', 'export class ⟦ { @@@ ) ] } finally');
    const changeSet = await adapter.analyzeDiff(
      diff,
      context(
        [hostile, file(SERVICE_PATH, NEXT_SERVICE)],
        [hostile, file(SERVICE_PATH, BASE_SERVICE)],
      ),
    );

    expect(changeSet.fragment.nodes.some((node) => node.id === 'file:src/evil.ts')).toBe(true);
    const serviceChange = changeSet.fileChanges.find((change) => change.path === SERVICE_PATH);
    expect(serviceChange?.symbolLevel).toBe(true);
    expect(serviceChange?.symbolChanges.length).toBeGreaterThan(0);
  });

  it('is deterministic — the same diff twice yields byte-identical output', async () => {
    const diff: GitDiff = {
      changedFiles: [
        { path: SERVICE_PATH, changeType: 'modified' },
        { path: 'src/gone.ts', changeType: 'deleted' },
      ],
    };
    const build = (): Promise<GraphChangeSet> =>
      adapter.analyzeDiff(
        diff,
        context(
          [file(SERVICE_PATH, NEXT_SERVICE)],
          [file(SERVICE_PATH, BASE_SERVICE), file('src/gone.ts', 'export const gone = 1;')],
        ),
      );

    expect(JSON.stringify(await build())).toBe(JSON.stringify(await build()));
  });
});

describe('analyzeDiff — other adapters share the implementation', () => {
  it('reports Prisma model changes at symbol level', async () => {
    const prisma = createPrismaAdapter();
    const diff: GitDiff = { changedFiles: [{ path: 'schema.prisma', changeType: 'modified' }] };
    const changeSet = await prisma.analyzeDiff(
      diff,
      context(
        [file('schema.prisma', 'model Deal {\n  id String\n}\nmodel Buyer {\n  id String\n}\n')],
        [file('schema.prisma', 'model Deal {\n  id String\n}\n')],
      ),
    );

    expect(
      changeSet.fileChanges[0]?.symbolChanges.map(
        (change) => `${change.kind}:${change.symbolName}`,
      ),
    ).toEqual(['added:Buyer']);
  });

  it('reports every file as unverifiable for the fallback adapter, which claims no extensions', async () => {
    const fallback = createFallbackAdapter();
    const diff: GitDiff = { changedFiles: [{ path: 'notes.md', changeType: 'modified' }] };
    const changeSet = await fallback.analyzeDiff(diff, context([file('notes.md', '# notes')]));

    expect(changeSet.fileChanges[0]?.symbolLevel).toBe(false);
    expect(changeSet.fragment.nodes.map((node) => node.id)).toEqual(['file:notes.md']);
  });
});
