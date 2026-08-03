import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readArchitectureConfig, readWorkspaceConfig } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyConfigOperation, configHistory } from './config-operations.js';
import { rollbackConfigChange } from './config-rollback.js';
import { initializeWorkspace } from './workspace.js';

import type { ConfigActor } from './config-operations.js';
import type { ArchitectureConfigDto, ConfigOperationDto } from '@impactgraph/contracts';

// Story 8.2 (§16) — one test per correction type: the operation applies, the persisted document
// says exactly what was corrected AND that it is human-confirmed, the §Z12 audit records it, and
// §Z14 rollback puts the previous document back.

const USER: ConfigActor = { kind: 'user' };
const AGENT: ConfigActor = { kind: 'agent', agentId: 'test-agent' };

let rootDir = '';

/** A fresh initialized workspace per test — corrections are file writes, so nothing is shared. */
const useTempWorkspace = (): void => {
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-corrections-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error('init failed');
    }
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });
};

const apply = (operation: ConfigOperationDto, actor: ConfigActor = USER): string => {
  const applied = applyConfigOperation({ rootDir, operation, actor });
  if (!applied.ok) {
    throw new Error(applied.error.message);
  }
  expect(applied.value.file).toBe('architecture.yml');
  expect(applied.value.reason).toBe(operation.reason);
  return applied.value.rollbackId;
};

/** Real files, because §Z13 checks an ownership glob against the repository the indexer walks. */
const writeSourceFile = (relativePath: string): void => {
  const absolute = join(rootDir, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, 'export const x = 1;\n', 'utf8');
};

const architecture = (): ArchitectureConfigDto => {
  const read = readArchitectureConfig(rootDir);
  if (!read.ok || read.value === undefined) {
    throw new Error('architecture.yml unreadable');
  }
  return read.value;
};

describe('§16 correction operations — components (Story 8.2)', () => {
  useTempWorkspace();

  it('rename-component persists a human-confirmed canonical mapping and rolls back', () => {
    apply({
      kind: 'rename-component',
      from: 'DealSvc',
      to: 'DealService',
      reason: 'the team calls it DealService',
    });
    const renames = architecture().renames ?? [];
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({
      from: 'DealSvc',
      to: 'DealService',
      reason: 'the team calls it DealService',
      source: 'human-confirmed',
    });
    expect(typeof renames[0]?.confirmedAt).toBe('string');

    const history = configHistory(rootDir);
    expect(history.ok && history.value).toHaveLength(1);

    expect(rollbackConfigChange({ rootDir, actor: USER }).ok).toBe(true);
    expect(architecture().renames ?? []).toEqual([]);
    const afterRollback = configHistory(rootDir);
    // the rollback APPENDED: both entries stand, nothing was rewritten (§Z14)
    expect(afterRollback.ok && afterRollback.value).toHaveLength(2);
  });

  it('rename-component rejects a no-op and a second rename of the same name (§Z13)', () => {
    expect(
      applyConfigOperation({
        rootDir,
        operation: { kind: 'rename-component', from: 'A', to: 'A', reason: 'noop' },
        actor: USER,
      }).ok,
    ).toBe(false);
    apply({ kind: 'rename-component', from: 'A', to: 'B', reason: 'first' });
    expect(
      applyConfigOperation({
        rootDir,
        operation: { kind: 'rename-component', from: 'A', to: 'C', reason: 'second' },
        actor: USER,
      }).ok,
    ).toBe(false);
    expect(architecture().renames?.[0]?.to).toBe('B');
  });

  it('merging duplicates is expressed as renaming both names onto one canonical name (§16)', () => {
    apply({ kind: 'rename-component', from: 'DealSvc', to: 'DealService', reason: 'merge a' });
    apply({ kind: 'rename-component', from: 'DealsService', to: 'DealService', reason: 'merge b' });
    expect(architecture().renames?.map((entry) => entry.to)).toEqual([
      'DealService',
      'DealService',
    ]);
  });

  it('assign-context updates the assignment for a path in place, never a second entry', () => {
    apply({
      kind: 'assign-context',
      path: 'src/deals/**',
      context: 'deals',
      reason: 'deal code lives here',
    });
    apply({
      kind: 'set-component-role',
      path: 'src/deals/**',
      role: 'domain',
      reason: 'domain layer',
    });
    expect(architecture().components).toEqual([
      { path: 'src/deals/**', context: 'deals', role: 'domain', source: 'human-confirmed' },
    ]);
    // re-assigning the same value is a no-op the validation gate rejects (§Z13)
    expect(
      applyConfigOperation({
        rootDir,
        operation: {
          kind: 'assign-context',
          path: 'src/deals/**',
          context: 'deals',
          reason: 'again',
        },
        actor: USER,
      }).ok,
    ).toBe(false);
  });

  it('mark-component accumulates §16 markers and rejects a duplicate marker', () => {
    apply({
      kind: 'mark-component',
      path: 'generated/**',
      marker: 'generated',
      reason: 'codegen output',
    });
    apply({
      kind: 'mark-component',
      path: 'generated/**',
      marker: 'ignored',
      reason: 'not reviewed by hand',
    });
    expect(architecture().components?.[0]?.markers).toEqual(['generated', 'ignored']);
    expect(
      applyConfigOperation({
        rootDir,
        operation: {
          kind: 'mark-component',
          path: 'generated/**',
          marker: 'generated',
          reason: 'again',
        },
        actor: USER,
      }).ok,
    ).toBe(false);
  });
});

describe('§16 correction operations — component ownership (Story 8.2)', () => {
  useTempWorkspace();

  it('set-component-owner persists a human-confirmed owner, audits it, and rolls back', () => {
    writeSourceFile('src/deals/policy.ts');
    apply({
      kind: 'set-component-owner',
      component: 'src/deals/**',
      owner: 'Deal Platform Team',
      reason: 'they run the deals domain',
    });
    expect(architecture().components).toEqual([
      { path: 'src/deals/**', owner: 'Deal Platform Team', source: 'human-confirmed' },
    ]);

    const history = configHistory(rootDir);
    expect(history.ok && history.value).toHaveLength(1);
    const entry = history.ok ? history.value[0] : undefined;
    expect(entry).toMatchObject({
      file: 'architecture.yml',
      classification: 'material',
      approval: 'approved',
      validationResult: 'valid',
      reason: 'they run the deals domain',
      operation: {
        kind: 'set-component-owner',
        component: 'src/deals/**',
        owner: 'Deal Platform Team',
      },
    });
    expect(entry?.previousDocument?.['components']).toBeUndefined();

    expect(rollbackConfigChange({ rootDir, actor: USER }).ok).toBe(true);
    expect(architecture().components ?? []).toEqual([]);
    const afterRollback = configHistory(rootDir);
    // the rollback APPENDED: both entries stand (§Z14)
    expect(afterRollback.ok && afterRollback.value).toHaveLength(2);
  });

  it('ownership is upserted onto the existing assignment, never a second entry for one path', () => {
    writeSourceFile('src/deals/policy.ts');
    apply({
      kind: 'set-component-role',
      path: 'src/deals/**',
      role: 'domain',
      reason: 'domain layer',
    });
    apply({
      kind: 'set-component-owner',
      component: 'src/deals/**',
      owner: '@acme/deals',
      reason: 'GitHub team owns it',
    });
    expect(architecture().components).toEqual([
      { path: 'src/deals/**', role: 'domain', owner: '@acme/deals', source: 'human-confirmed' },
    ]);
    // handing over ownership is a normal, audited change
    apply({
      kind: 'set-component-owner',
      component: 'src/deals/**',
      owner: 'deals@acme.example',
      reason: 'handed over to the distribution list',
    });
    expect(architecture().components?.[0]?.owner).toBe('deals@acme.example');
  });

  it('re-stating the same owner is rejected as a no-op (§Z13)', () => {
    writeSourceFile('src/deals/policy.ts');
    apply({
      kind: 'set-component-owner',
      component: 'src/deals/**',
      owner: 'deals-team',
      reason: 'first',
    });
    const duplicate = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'set-component-owner',
        component: 'src/deals/**',
        owner: 'deals-team',
        reason: 'again',
      },
      actor: USER,
    });
    expect(duplicate.ok).toBe(false);
    expect(architecture().components).toHaveLength(1);
  });

  it('an ownership glob that matches no file is a validation error, not a silent no-op', () => {
    writeSourceFile('src/deals/policy.ts');
    const rejected = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'set-component-owner',
        component: 'src/billing/**',
        owner: 'billing-team',
        reason: 'a directory that does not exist yet',
      },
      actor: USER,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? '' : rejected.error.message).toContain('matches no file');
    // nothing was written and nothing was audited
    expect(architecture().components ?? []).toEqual([]);
    const history = configHistory(rootDir);
    expect(history.ok && history.value).toHaveLength(0);
  });
});

describe('§16 corrections — relationships, precedence source, and the audit envelope', () => {
  useTempWorkspace();

  it('set-relationship-confirmation records confirm and reject, and flips an existing decision', () => {
    apply({
      kind: 'set-relationship-confirmation',
      edgeId: 'edge:a->b',
      confirmed: false,
      reason: 'that import is a test-only shim',
    });
    const decisions = architecture().relationships ?? [];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      edgeId: 'edge:a->b',
      confirmed: false,
      reason: 'that import is a test-only shim',
      source: 'human-confirmed',
    });
    expect(typeof decisions[0]?.confirmedAt).toBe('string');
    apply({
      kind: 'set-relationship-confirmation',
      edgeId: 'edge:a->b',
      confirmed: true,
      reason: 'the shim went away, the dependency is real',
    });
    expect(architecture().relationships).toHaveLength(1);
    expect(architecture().relationships?.[0]?.confirmed).toBe(true);
  });

  it('an agent applying a correction autonomously records agent-approved, not human-confirmed', () => {
    const modeSet = applyConfigOperation({
      rootDir,
      operation: { kind: 'set-automation-mode', mode: 'autonomous', reason: 'test setup' },
      actor: USER,
    });
    expect(modeSet.ok).toBe(true);
    // corrections are material, so autonomous mode still gates them — the human approves here
    const gated = applyConfigOperation({
      rootDir,
      operation: { kind: 'set-component-role', path: 'src/**', role: 'domain', reason: 'guess' },
      actor: AGENT,
    });
    expect(gated.ok).toBe(false);

    // with `add-ignore` declared safe an agent CAN write unattended; the record says so
    const safeApplied = applyConfigOperation({
      rootDir,
      operation: { kind: 'add-ignore', glob: 'dist/**', reason: 'build output' },
      actor: AGENT,
    });
    expect(safeApplied.ok && safeApplied.value.approval).toBe('auto');
    const config = readWorkspaceConfig(rootDir);
    expect(config.ok && config.value?.ignore).toContain('dist/**');
  });

  it('every correction carries the full §Z12 audit envelope with the prior document', () => {
    apply({ kind: 'rename-component', from: 'A', to: 'B', reason: 'clearer name' });
    const applied = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'mark-component',
        path: 'infra/**',
        marker: 'infrastructure',
        reason: 'terraform',
        confidence: 0.9,
      },
      actor: { kind: 'agent', agentId: 'mcp-client', modelId: 'claude-sonnet-4-5' },
      approvedByUser: true,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value).toMatchObject({
      actor: { kind: 'agent', agentId: 'mcp-client', modelId: 'claude-sonnet-4-5' },
      classification: 'material',
      approval: 'approved',
      file: 'architecture.yml',
      validationResult: 'valid',
      confidence: 0.9,
    });
    // the prior document still holds the earlier rename — nothing was rewritten
    expect(applied.value.previousDocument?.['renames']).toHaveLength(1);
    expect(applied.value.previousDocument?.['components']).toBeUndefined();
  });
});
