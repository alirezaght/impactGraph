import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { searchComponents } from './component-search.js';
import { queryFieldFlow } from './field-flow.js';
import { detectTransformations } from './field-transformations.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { readRepositoryRoster } from './registered-repositories.js';
import { initializeWorkspace } from './workspace.js';

/**
 * The first observed trial case (items 6, 7, 11).
 *
 * "A nullable field crosses an HTTP boundary and is later removed or merged in another service."
 * `expiresAt` is nullable, it is renamed to `expiry` on the way out, and on the far side a null makes
 * the key vanish, then a default masks the vanishing, then the row is skipped. None of that was
 * visible before: the flow, the rename, the boundary and the three transformations.
 */
describe('the nullable-boundary case (items 6, 7)', () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-nullable-'));
    cpSync(fixtureRepoPath('nullable-boundary'), repoDir, { recursive: true });
    initializeWorkspace(repoDir);
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'nb@test.dev'],
      ['config', 'user.name', 'NB Test'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-m', 'fixture'],
    ]) {
      execFileSync('git', args, { cwd: repoDir });
    }
    expect((await performIndexRun(repoDir)).ok).toBe(true);
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const FIELD = 'field:deal-api/src/deal-dto.ts#DealRow.expiresAt';

  it('reports the field as nullable', async () => {
    const flow = await queryFieldFlow(repoDir, FIELD);
    expect(flow.ok).toBe(true);
    if (!flow.ok) {
      return;
    }
    expect(flow.value.field.nullable).toBe(true);
    expect(flow.value.field.name).toBe('DealRow.expiresAt?');
  });

  it('answers "where does this field go?" and "where is it renamed?"', async () => {
    const flow = await queryFieldFlow(repoDir, FIELD);
    expect(flow.ok).toBe(true);
    if (!flow.ok) {
      return;
    }
    expect(flow.value.flowsTo.map((hop) => hop.name)).toContain('DealDto.expiry?');
    expect(flow.value.renames.map((hop) => hop.name)).toContain('DealDto.expiry?');
    // The target is nullable too, which is the answer to "what happens when this value is null?" at
    // the contract level: the null survives the mapping.
    expect(flow.value.renames[0]?.nullable).toBe(true);
  });

  it('surfaces the consumer-side transformations, with line evidence', async () => {
    // Queried from the CONSUMER's field: the three behaviours that make a null `expiry` disappear —
    // null removal, the default that masks it, and the row skip — all live in the indexer.
    const flow = await queryFieldFlow(
      repoDir,
      'field:search-service/src/deal-indexer.ts#SearchDocument.expiry',
    );
    expect(flow.ok).toBe(true);
    if (!flow.ok) {
      return;
    }
    const kinds = new Set(flow.value.transformations.map((entry) => entry.kind));
    expect(kinds.has('null-removal')).toBe(true);
    expect(kinds.has('row-skip')).toBe(true);
    expect(kinds.has('fallback')).toBe(true);
    expect(kinds.has('merge')).toBe(true);
    for (const entry of flow.value.transformations) {
      expect(entry.line).toBeGreaterThan(0);
      expect(entry.excerpt.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it('states what field flow does NOT cover, so an empty answer cannot be over-read', async () => {
    const flow = await queryFieldFlow(repoDir, FIELD);
    expect(flow.ok).toBe(true);
    if (!flow.ok) {
      return;
    }
    const limitations = flow.value.outcome.limitations.join(' ');
    expect(limitations).toContain('within a single file');
    expect(limitations).toContain('not registered in this workspace');
    expect(flow.value.outcome.scope).toContain('snapshot');
  });

  it('joins the cross-service HTTP call to the route it targets (item 6)', async () => {
    const found = await searchComponentsFor(repoDir, 'fetchDeals');
    expect(found).toContain('fetchDeals');
    const graph = await loadGraph(repoDir);
    const edges = [...graph.edges.values()];
    // The consumer names an ABSOLUTE url (`https://deal-api.example.com/api/deals`) and imports
    // nothing from the producer. The only shared fact is the path, and that is enough.
    const call = edges.find(
      (edge) =>
        edge.type === 'CALLS_ENDPOINT' &&
        edge.sourceId.includes('deal-client.ts#fetchDeals') &&
        edge.targetId === 'route:GET /api/deals',
    );
    expect(call).toBeDefined();
    // And the declared contract is joined to the route that implements it.
    expect(
      edges.some(
        (edge) =>
          edge.type === 'IMPLEMENTS_OPERATION' && edge.targetId === 'operation:GET /api/deals',
      ),
    ).toBe(true);
  });

  it('refuses a field id that is not indexed rather than answering emptily', async () => {
    const flow = await queryFieldFlow(repoDir, 'field:nowhere.ts#Ghost.field');
    expect(flow.ok).toBe(false);
    if (flow.ok) {
      return;
    }
    expect(flow.error.message).toContain('no indexed field');
  });
});

describe('detectTransformations (item 7)', () => {
  it('names the null removal, the row skip, the fallback and the merge', () => {
    const found = detectTransformations(
      'src/indexer.ts',
      [
        'const compacted = {};',
        'if (value !== null) { compacted[key] = value; }',
        'const merged = { ...defaults, ...compacted };',
        'const title = merged.title ?? "untitled";',
        'if (merged.expiry === undefined) {',
        '  continue;',
        '}',
      ].join('\n'),
    );
    const kinds = new Set(found.map((entry) => entry.kind));
    expect(kinds.has('null-removal')).toBe(true);
    expect(kinds.has('row-skip')).toBe(true);
    expect(kinds.has('fallback')).toBe(true);
    expect(kinds.has('merge')).toBe(true);
  });

  it('reports nothing for code that states none of the patterns', () => {
    expect(detectTransformations('src/plain.ts', 'export const add = (a, b) => a + b;')).toEqual(
      [],
    );
  });

  it('ignores comments — documentation about a pattern is not the pattern', () => {
    expect(
      detectTransformations('src/doc.ts', '// this function used to `continue` on a null value'),
    ).toEqual([]);
  });
});

describe('registered repositories (item 6)', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-roster-'));
    cpSync(fixtureRepoPath('nullable-boundary'), repoDir, { recursive: true });
    initializeWorkspace(repoDir);
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const writeConfig = (repositories: string): void => {
    writeFileSync(
      join(repoDir, '.impactgraph', 'config.yml'),
      `schemaVersion: 1\n${repositories}`,
      'utf8',
    );
  };

  it('says outright that nothing else is registered', () => {
    writeConfig('');
    const roster = readRepositoryRoster(repoDir);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    expect(roster.value.members).toHaveLength(1);
    expect(roster.value.limitations[0]).toContain('no related repositories are registered');
  });

  it('resolves a present member and keeps its own identity', () => {
    writeConfig('repositories:\n  - name: search-service\n    path: search-service\n');
    const roster = readRepositoryRoster(repoDir);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    const member = roster.value.members.find((entry) => entry.name === 'search-service');
    expect(member?.present).toBe(true);
    expect(member?.resolvedPath).toContain('search-service');
    expect(roster.value.absent).toEqual([]);
  });

  it('reports a registered-but-absent repository as a scope limitation, not an error', () => {
    writeConfig('repositories:\n  - name: billing\n    path: ../billing\n');
    const roster = readRepositoryRoster(repoDir);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    expect(roster.value.absent.map((entry) => entry.name)).toEqual(['billing']);
    expect(roster.value.limitations.join(' ')).toContain('unresolved consumer');
  });

  it('refuses a path that escapes the workspace root — configuration is untrusted', () => {
    writeConfig('repositories:\n  - name: escape\n    path: ../../../etc\n');
    const roster = readRepositoryRoster(repoDir);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    const member = roster.value.members.find((entry) => entry.name === 'escape');
    expect(member?.present).toBe(false);
    expect(member?.reason).toContain('outside the workspace root');
  });

  it('keeps a disabled member registered but out of the analyzed set', () => {
    writeConfig(
      'repositories:\n  - name: search-service\n    path: search-service\n    enabled: false\n',
    );
    const roster = readRepositoryRoster(repoDir);
    expect(roster.ok).toBe(true);
    if (!roster.ok) {
      return;
    }
    expect(roster.value.absent).toEqual([]);
    expect(roster.value.limitations.join(' ')).toContain('Disabled in configuration');
  });
});

/** Names of the components a query finds — a thin helper so assertions stay readable. */
const searchComponentsFor = async (rootDir: string, query: string): Promise<readonly string[]> => {
  const found = await searchComponents(rootDir, query, { limit: 10 });
  return found.ok ? found.value.components.map((hit) => hit.name) : [];
};

const loadGraph = async (rootDir: string) => {
  const loaded = await withIndexStore(rootDir, async (store) => loadCurrentGraph(store));
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value.graph;
};
