import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRecord } from './registry-flows.js';
import { callTool } from './registry.js';

import type { McpToolName } from '@impactgraph/contracts';

// find_references / search_literals end-to-end through callTool: contract-validated on both
// ends against a real indexed fixture repository. The fixture is ts-basic plus one file whose
// member call passes a SQL string — the exact pattern ("who calls X?", "where else is
// `= ANY(:ids)` used?") that previously needed grep.

let repoDir: string;

const tool = async (name: McpToolName, args: unknown = {}): Promise<Record<string, unknown>> => {
  const outcome = await callTool(repoDir, name, args);
  if (!outcome.ok) {
    throw new Error(`${name} failed: ${outcome.error.message}`);
  }
  return asRecord(outcome.payload);
};

const toolError = async (name: McpToolName, args: unknown = {}): Promise<string> => {
  const outcome = await callTool(repoDir, name, args);
  if (outcome.ok) {
    throw new Error(`${name} unexpectedly succeeded`);
  }
  return outcome.error.message;
};

beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-mcp-refs-'));
  cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
  mkdirSync(join(repoDir, 'src', 'db'), { recursive: true });
  writeFileSync(
    join(repoDir, 'src', 'db', 'item-queries.ts'),
    [
      "import { DealRepository } from '../lib/deal-repository';",
      '',
      'const db = { query: (sql: string, ids: string[]): unknown => [sql, ids] };',
      '',
      'export function removeItems(ids: string[]): unknown {',
      "  return db.query('DELETE FROM items WHERE id = ANY(:ids)', ids);",
      '}',
      '',
      'export function useRepository(): DealRepository {',
      '  return new DealRepository();',
      '}',
      '',
    ].join('\n'),
  );
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repoDir });
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'refs@test.dev');
  git('config', 'user.name', 'Refs Test');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'fixture');
  await tool('initialize_workspace');
  await tool('index_workspace');
}, 120_000);

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('find_references via MCP (§21, both-end validation)', () => {
  it('answers "who implements Searchable?" from IMPLEMENTS edges', async () => {
    const result = await tool('find_references', {
      query: 'Searchable',
      kinds: ['implementations'],
    });
    expect(result['resolution']).toBe('resolved');
    const references = result['references'] as {
      kind: string;
      direction: string;
      counterparts: { name: string; provenance: string }[];
    }[];
    expect(references).toHaveLength(1);
    expect(references[0]?.kind).toBe('implementations');
    expect(references[0]?.direction).toBe('incoming');
    expect(references[0]?.counterparts.map((hit) => hit.name)).toContain('DealService');
    expect(references[0]?.counterparts[0]?.provenance).toBe('static-analysis');
  });

  it('answers "who extends BaseService?" from EXTENDS edges', async () => {
    const result = await tool('find_references', { query: 'BaseService', kinds: ['extensions'] });
    const references = result['references'] as { counterparts: { name: string }[] }[];
    expect(references[0]?.counterparts.map((hit) => hit.name)).toContain('DealService');
  });

  it('answers "who calls query?" with a name-matched member call site', async () => {
    const result = await tool('find_references', { query: 'query' });
    const sites = result['nameMatchedCallSites'] as {
      basis: string;
      filePath: string;
      calleeName: string;
      receiver?: string;
      sampleArgument?: string;
    }[];
    const site = sites.find((entry) => entry.filePath === 'src/db/item-queries.ts');
    expect(site).toBeDefined();
    expect(site?.basis).toBe('name-match');
    expect(site?.receiver).toBe('db');
    expect(site?.sampleArgument).toContain('DELETE FROM items');
    const coverage = asRecord(result['coverage']);
    expect((coverage['searched'] as string[]).length).toBeGreaterThanOrEqual(2);
    expect((coverage['knownLimits'] as string[]).join(' ')).toContain('name');
  });

  it('rejects invalid input at the contract before any handler runs', async () => {
    expect(await toolError('find_references', {})).toContain('invalid input');
    expect(await toolError('find_references', { query: 'x', kinds: ['owners'] })).toContain(
      'invalid input',
    );
  });
});

describe('search_literals via MCP (§21, both-end validation)', () => {
  it('finds the `= ANY(:ids)` SQL fragment passed to a query API', async () => {
    const result = await tool('search_literals', { pattern: '= ANY(:ids)' });
    const matches = result['matches'] as {
      filePath: string;
      ownerKind: string;
      ownerName: string;
      receiver?: string;
      literal: string;
      truncated: boolean;
    }[];
    const match = matches.find((entry) => entry.filePath === 'src/db/item-queries.ts');
    expect(match).toBeDefined();
    expect(match?.ownerKind).toBe('call');
    expect(match?.ownerName).toBe('query');
    expect(match?.receiver).toBe('db');
    expect(match?.literal).toBe('DELETE FROM items WHERE id = ANY(:ids)');
    expect(match?.truncated).toBe(false);
    expect(result['scope']).toContain('NOT a full-text search');
    expect(result['matchMode']).toBe('substring');
  });

  it('an invalid regex is a typed error, never a crash', async () => {
    expect(await toolError('search_literals', { pattern: '(', regex: true })).toContain(
      'invalid regular expression',
    );
  });
});
