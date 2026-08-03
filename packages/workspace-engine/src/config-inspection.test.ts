import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRulesConfig } from '@impactgraph/persistence';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDocuments as readConfigurationDocuments } from './config-changes.js';
import { detectConfigDrift } from './config-drift.js';
import { explainConfiguration } from './config-explain.js';
import {
  confirmConfigurationValue,
  refreshConfiguration,
  removeStaleConfiguration,
} from './config-maintenance.js';
import { validateConfiguration } from './config-validation.js';
import { performIndexRun } from './indexing.js';
import { initializeWorkspace } from './workspace.js';

import type { ConfigActor } from './config-operations.js';

// Story 14.2/14.5 — the §Z7 inspection + maintenance tools over a real indexed workspace.
// Sequential on purpose: confirm (§Z5) must change what the LATER maintenance tools may do.

const AGENT: ConfigActor = { kind: 'agent', agentId: 'test-agent' };

describe('configuration inspection and maintenance (§Z5/§Z7/§Z10/§Z13)', () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-configtools-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'config@test.dev');
    git('config', 'user.name', 'Config');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    writeFileSync(
      join(repoDir, '.impactgraph/architecture.yml'),
      'schemaVersion: 1\ncontexts:\n  - name: legacy-billing\n    paths:\n      - src/billing/**\n',
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
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('get_configuration returns every committed document as a validated DTO', () => {
    const documents = readConfigurationDocuments(repoDir);
    if (!documents.ok) {
      throw new Error(documents.error.message);
    }
    expect(documents.value.workspace.schemaVersion).toBe(1);
    expect(documents.value.aliases.aliases?.['deals']).toBe('DealService');
    expect(documents.value.architecture.contexts?.[0]?.name).toBe('legacy-billing');
    expect(documents.value.rules.rules?.[0]?.id).toBe('no-domain-to-infra');
  });

  it('validate_configuration passes the §Z13 gate on the seeded configuration', () => {
    const report = validateConfiguration(repoDir);
    if (!report.ok) {
      throw new Error(report.error.message);
    }
    expect(report.value.valid).toBe(true);
    expect(report.value.files.map((file) => file.file)).toEqual([
      'config.yml',
      'architecture.yml',
      'aliases.yml',
      'rules.yml',
    ]);
    expect(report.value.files.every((file) => file.valid && file.present)).toBe(true);
    expect(report.value.crossFileMessages).toEqual([]);
  });

  it('explain_configuration explains a live alias and what it matches in the graph', async () => {
    const explained = await explainConfiguration(repoDir, 'deals');
    if (!explained.ok) {
      throw new Error(explained.error.message);
    }
    expect(explained.value.found).toBe(true);
    expect(explained.value.subjectKind).toBe('alias');
    expect(explained.value.file).toBe('aliases.yml');
    expect(explained.value.definition).toEqual({ alias: 'deals', canonical: 'DealService' });
    expect(explained.value.confirmed).toBe(false);
    expect(explained.value.affects.nodeCount).toBeGreaterThan(0);
  });

  it('explain_configuration reports absence instead of inventing a meaning', async () => {
    const explained = await explainConfiguration(repoDir, 'not-configured-anywhere');
    if (!explained.ok) {
      throw new Error(explained.error.message);
    }
    expect(explained.value.found).toBe(false);
    expect(explained.value.subjectKind).toBeUndefined();
    expect(explained.value.affects.nodeCount).toBe(0);
  });

  it('confirm_configuration_value records the §Z5 marker through the audited path', async () => {
    const confirmed = confirmConfigurationValue(repoDir, AGENT, {
      subjectKind: 'alias',
      subject: 'invoices',
      reason: 'InvoiceService lands next sprint — keep the mapping',
    });
    if (!confirmed.ok) {
      throw new Error(confirmed.error.message);
    }
    expect(confirmed.value.file).toBe('architecture.yml');
    expect(confirmed.value.confirmationCount).toBe(1);
    expect(confirmed.value.rollbackId.length).toBeGreaterThan(0);

    // §Z5: the dangling alias is still REPORTED, but no longer proposed for removal
    const drift = await detectConfigDrift(repoDir);
    if (!drift.ok) {
      throw new Error(drift.error.message);
    }
    expect(drift.value.suggestions.some((item) => item.subject === 'invoices')).toBe(false);
    const kept = drift.value.needsReview.find((item) => item.subject === 'invoices');
    expect(kept?.detail).toContain('human-confirmed');

    // the explanation now shows the confirmation and the audit entry that introduced it
    const explained = await explainConfiguration(repoDir, 'invoices');
    if (!explained.ok) {
      throw new Error(explained.error.message);
    }
    expect(explained.value.confirmed).toBe(true);
    expect(explained.value.origin?.rollbackId).toBe(confirmed.value.rollbackId);
    expect(explained.value.origin?.actorKind).toBe('agent');
    expect(explained.value.origin?.reason).toContain('next sprint');
  });

  it('confirming twice, or confirming something that does not exist, is a typed error', () => {
    const again = confirmConfigurationValue(repoDir, AGENT, {
      subjectKind: 'alias',
      subject: 'invoices',
      reason: 'again',
    });
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.error.message).toContain('already human-confirmed');

    const ghost = confirmConfigurationValue(repoDir, AGENT, {
      subjectKind: 'context',
      subject: 'no-such-context',
      reason: 'x',
    });
    expect(ghost.ok).toBe(false);
    expect(ghost.ok ? '' : ghost.error.message).toContain('no context named');
  });

  it('remove_stale_configuration removes dangling entries but never a confirmed one', async () => {
    const removed = await removeStaleConfiguration(repoDir, AGENT);
    if (!removed.ok) {
      throw new Error(removed.error.message);
    }
    expect(removed.value.removed.map((entry) => entry.subject)).toEqual(['no-domain-to-infra']);
    expect(removed.value.removed[0]?.file).toBe('rules.yml');
    const skipped = removed.value.skipped.find((entry) => entry.subject === 'invoices');
    expect(skipped?.reason).toContain('human-confirmed');

    // the rule is gone from the document; the confirmed alias is still there
    const documents = readConfigurationDocuments(repoDir);
    expect(documents.ok && (documents.value.rules.rules ?? [])).toEqual([]);
    expect(documents.ok && documents.value.aliases.aliases?.['invoices']).toBe('InvoiceService');
  });

  it('refresh_configuration re-applies detection and reports what this run changed', async () => {
    const refreshed = await refreshConfiguration(repoDir, AGENT);
    if (!refreshed.ok) {
      throw new Error(refreshed.error.message);
    }
    // the uncovered ts-basic package gets its context — the same suggestion generation applies
    expect(refreshed.value.applied.some((item) => item.kind === 'uncovered-package')).toBe(true);
    expect(refreshed.value.changedFiles).toEqual(['architecture.yml']);
    // the delta report is derived from the §Z12 trail: earlier entries existed
    expect(refreshed.value.changeCountBefore).toBeGreaterThan(0);
    expect(refreshed.value.previousChangeAt).toBeDefined();

    // a second refresh has nothing left to apply — and says so
    const second = await refreshConfiguration(repoDir, AGENT);
    if (!second.ok) {
      throw new Error(second.error.message);
    }
    expect(second.value.applied).toEqual([]);
    expect(second.value.changedFiles).toEqual([]);
  });

  it('validate_configuration reports an invalid document instead of repairing it', () => {
    const aliasesPath = join(repoDir, '.impactgraph/aliases.yml');
    writeFileSync(aliasesPath, 'schemaVersion: 2\naliases:\n  deals: DealService\n');
    const report = validateConfiguration(repoDir);
    if (!report.ok) {
      throw new Error(report.error.message);
    }
    expect(report.value.valid).toBe(false);
    const aliases = report.value.files.find((file) => file.file === 'aliases.yml');
    expect(aliases?.valid).toBe(false);
    expect(aliases?.messages[0]).toContain('aliases.yml');
    // the file on disk is untouched — validation never writes (§Z13)
    expect(readRulesConfig(repoDir).ok).toBe(true);
  });
});
