import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRecord } from './registry-flows.js';
import { callTool } from './registry.js';

import type { McpToolName } from '@impactgraph/contracts';

// The coverage-first workflow: a feature spanning registered repositories, a registered-but-
// absent repository, an unregistered candidate, unresolved concepts, automatic indexing of a
// repository registered after the last run, and readiness withholding on insufficient coverage.

describe('MCP workspace coverage workflow', () => {
  let repoDir: string;

  const tool = async (name: McpToolName, args: unknown = {}): Promise<Record<string, unknown>> => {
    const outcome = await callTool(repoDir, name, args);
    if (!outcome.ok) {
      throw new Error(`${name} failed: ${outcome.error.message}`);
    }
    return asRecord(outcome.payload);
  };

  const write = (relativePath: string, content: string): void => {
    const absolute = join(repoDir, relativePath);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  };

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-mcp-coverage-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    write(
      'billing/src/billing-api.ts',
      'export class BillingApi {\n  charge(amount: number): number {\n    return amount;\n  }\n}\n',
    );
    write('billing/package.json', JSON.stringify({ name: 'billing' }));
    write('web/page.ts', 'export const page = 1;\n');
    mkdirSync(join(repoDir, 'web', '.git'), { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'mcp@test.dev');
    git('config', 'user.name', 'MCP Test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('status validates coverage: registered, missing and candidate repositories', async () => {
    await tool('initialize_workspace');
    writeFileSync(
      join(repoDir, '.impactgraph', 'config.yml'),
      'schemaVersion: 1\nrepositories:\n  - name: billing\n    path: billing\n  - name: ghost\n    path: ghost\n',
    );
    const status = await tool('get_workspace_status');
    const repositories = status['repositories'] as { name: string; indexed: boolean }[];
    expect(repositories.map((repo) => repo.name)).toEqual([
      '(workspace root)',
      'billing',
      'ghost',
    ]);
    const candidates = status['candidateRepositories'] as { name: string }[];
    expect(candidates.map((candidate) => candidate.name)).toEqual(['web']);
  });

  it('index_workspace indexes every registered, present repository into one graph', async () => {
    const indexed = await tool('index_workspace');
    const repositories = indexed['repositories'] as {
      name: string;
      indexed: boolean;
      fileCount: number;
      reason?: string;
    }[];
    const billing = repositories.find((repo) => repo.name === 'billing');
    expect(billing?.indexed).toBe(true);
    expect(billing?.fileCount).toBeGreaterThan(0);
    const ghost = repositories.find((repo) => repo.name === 'ghost');
    expect(ghost?.indexed).toBe(false);
    expect(ghost?.reason).toContain('does not exist');
  });

  it('cross-repository analysis resolves components from a registered repository', async () => {
    const found = await tool('find_components', { query: 'BillingApi' });
    const components = found['components'] as { name: string; path?: string }[];
    expect(
      components.some((hit) => hit.name === 'BillingApi' && hit.path?.startsWith('billing/')),
    ).toBe(true);

    await tool('submit_specification', {
      name: 'cross-repo.md',
      content: '# Charging\nDealService must call BillingApi to charge expired deals.\n',
    });
    const summary = await tool('analyze_impact', { specificationId: 'spec-cross-repo' });
    const coverage = asRecord(summary['workspaceCoverage']);
    expect(coverage['status']).toBe('adequate');
    const repositories = asRecord(coverage['repositories']);
    expect((repositories['indexed'] as { name: string }[]).map((repo) => repo.name)).toContain(
      'billing',
    );
    expect(
      (repositories['registeredButMissing'] as { name: string }[]).map((repo) => repo.name),
    ).toContain('ghost');
    const specification = asRecord(summary['specification']);
    expect(specification['readiness']).toBeDefined();
    const actions = summary['requiredActions'] as { action: string }[];
    expect(actions.map((action) => action.action)).toContain('register-missing-repositories');
  });

  it('withholds readiness and demands next actions when coverage is insufficient', async () => {
    await tool('submit_specification', {
      name: 'alien.md',
      content: '# Reconciliation\nPaymentGateway must reconcile LedgerEntries nightly.\n',
    });
    const summary = await tool('analyze_impact', { specificationId: 'spec-alien' });
    const coverage = asRecord(summary['workspaceCoverage']);
    expect(coverage['status']).toBe('insufficient-coverage');
    expect((coverage['reasons'] as string[]).length).toBeGreaterThan(0);
    const specification = asRecord(summary['specification']);
    expect(specification['readiness']).toBeUndefined();
    expect(specification['readinessWithheldReason']).toContain('coverage');
    const analysis = asRecord(summary['analysis']);
    expect(analysis['provisional']).toBe(true);
    const actions = summary['requiredActions'] as {
      action: string;
      instruction: string;
      repositories?: string[];
    }[];
    const kinds = actions.map((action) => action.action);
    expect(kinds).toContain('register-missing-repositories');
    expect(kinds).toContain('confirm-candidate-repositories');
    const confirm = actions.find((action) => action.action === 'confirm-candidate-repositories');
    expect(confirm?.repositories).toEqual(['web']);
    expect(confirm?.instruction).toContain('Ask the user');
  });

  it('automatically indexes a repository registered after the last run', async () => {
    write(
      'search/src/search-index.ts',
      'export class SearchIndex {\n  rebuild(): void {\n    // deterministic fixture\n  }\n}\n',
    );
    write('search/package.json', JSON.stringify({ name: 'search' }));
    appendFileSync(
      join(repoDir, '.impactgraph', 'config.yml'),
      '  - name: search\n    path: search\n',
    );
    await tool('submit_specification', {
      name: 'search-feature.md',
      content: '# Search\nSearchIndex must rebuild nightly.\n',
    });
    const summary = await tool('analyze_impact', { specificationId: 'spec-search-feature' });
    const coverage = asRecord(summary['workspaceCoverage']);
    const repositories = asRecord(coverage['repositories']);
    const indexed = repositories['indexed'] as { name: string; fileCount: number }[];
    const search = indexed.find((repo) => repo.name === 'search');
    expect(search?.fileCount).toBeGreaterThan(0);
    expect(coverage['status']).toBe('adequate');
    const specification = asRecord(summary['specification']);
    expect(specification['readiness']).toBeDefined();
  });
});
