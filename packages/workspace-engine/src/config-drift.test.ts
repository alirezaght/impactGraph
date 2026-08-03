import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { detectConfigDrift } from './config-drift.js';
import { performIndexRun } from './indexing.js';
import { initializeWorkspace } from './workspace.js';

import type { DriftReport } from './config-drift.js';

// Story 14.5 — §Z10 drift scenarios against a real indexed workspace: stale human mappings
// are flagged and KEPT; dangling aliases get a suggested remove operation; rules referencing
// undefined roles surface; packages without a context produce an add-context suggestion.

describe('configuration drift detection (Story 14.5, §Z5/§Z10)', () => {
  let repoDir: string;
  let report: DriftReport;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-drift-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'drift@test.dev');
    git('config', 'user.name', 'Drift');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    // Seed drift: a context pointing at a deleted directory, an alias to a vanished
    // component, and a rule referencing a role no assignment defines.
    writeFileSync(
      join(repoDir, '.impactgraph/architecture.yml'),
      [
        'schemaVersion: 1',
        'contexts:',
        '  - name: legacy-billing',
        '    paths:',
        '      - src/billing/**',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(repoDir, '.impactgraph/aliases.yml'),
      'schemaVersion: 1\naliases:\n  invoices: InvoiceService\n  deals: DealService\n',
    );
    writeFileSync(
      join(repoDir, '.impactgraph/rules.yml'),
      [
        'schemaVersion: 1',
        'rules:',
        '  - id: no-domain-to-infra',
        '    type: dependency-direction',
        '    sourceRole: domain',
        '    forbiddenTargetRole: infrastructure',
        '',
      ].join('\n'),
    );
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const drift = await detectConfigDrift(repoDir);
    if (!drift.ok) {
      throw new Error(drift.error.message);
    }
    report = drift.value;
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('flags stale contexts for review — never deletes them (§Z5)', () => {
    const stale = report.needsReview.find((item) => item.kind === 'stale-context');
    expect(stale?.subject).toBe('legacy-billing');
    expect(stale?.detail).toContain('kept for review');
  });

  it('dangling aliases get a suggested remove-alias operation; live aliases stay silent', () => {
    const dangling = report.suggestions.filter((item) => item.kind === 'dangling-alias');
    expect(dangling.map((item) => item.subject)).toEqual(['invoices']);
    expect(dangling[0]?.suggestedOperation).toMatchObject({
      kind: 'remove-alias',
      alias: 'invoices',
    });
  });

  it('rules referencing roles no assignment defines are surfaced', () => {
    const rule = report.needsReview.find((item) => item.kind === 'dangling-rule-reference');
    expect(rule?.subject).toBe('no-domain-to-infra');
    expect(rule?.detail).toContain('domain');
  });

  it('packages without a context produce an add-context suggestion (§Z10 "Added")', () => {
    const uncovered = report.suggestions.find((item) => item.kind === 'uncovered-package');
    expect(uncovered?.suggestedOperation?.kind).toBe('add-context');
  });
});
