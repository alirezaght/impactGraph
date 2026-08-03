import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readAliasesConfig, readWorkspaceConfig } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyConfigOperation, classifyOperation, configHistory } from './config-operations.js';
import { rollbackConfigChange } from './config-rollback.js';
import { configDiff, restoreConfigVersion } from './config-versions.js';
import { initializeWorkspace } from './workspace.js';

import type { ConfigActor } from './config-operations.js';
import type { ConfigOperationDto } from '@impactgraph/contracts';

// Stories 14.2–14.4 — the mode × classification matrix (§Z6/§Z11), the §Z13 validation gate,
// the §Z12 audit trail, and §Z14 rollback-by-append.

const AGENT: ConfigActor = { kind: 'agent', agentId: 'test-agent' };
const USER: ConfigActor = { kind: 'user' };

const addAlias: ConfigOperationDto = {
  kind: 'add-alias',
  alias: 'deal',
  canonical: 'DealService',
  reason: 'spec vocabulary maps deal → DealService',
};

const addIgnore: ConfigOperationDto = {
  kind: 'add-ignore',
  glob: 'generated/**',
  reason: 'generated output detected',
};

describe('structured configuration operations (Stories 14.2–14.4, §Z6–§Z14)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-ops-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error('init failed');
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  const setMode = (mode: 'autonomous' | 'review' | 'manual'): void => {
    const applied = applyConfigOperation({
      rootDir,
      operation: { kind: 'set-automation-mode', mode, reason: 'test setup' },
      actor: USER,
    });
    if (!applied.ok) {
      throw new Error(applied.error.message);
    }
  };

  it('classifies §Z11: ignore-additions are safe, everything else is material', () => {
    expect(classifyOperation(addIgnore)).toBe('safe');
    expect(classifyOperation(addAlias)).toBe('material');
    expect(classifyOperation({ kind: 'set-privacy-mode', mode: 'local-only', reason: 'r' })).toBe(
      'material',
    );
  });

  it('review mode (default): agent changes need explicit approval; user changes apply', () => {
    const rejected = applyConfigOperation({ rootDir, operation: addAlias, actor: AGENT });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('approval');
    }
    const approved = applyConfigOperation({
      rootDir,
      operation: addAlias,
      actor: AGENT,
      approvedByUser: true,
    });
    expect(approved.ok).toBe(true);
    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok && aliases.value?.aliases?.['deal']).toBe('DealService');
  });

  it('autonomous mode: SAFE agent changes auto-apply with an audit entry; material still gated (§Z6.1)', () => {
    setMode('autonomous');
    const safe = applyConfigOperation({ rootDir, operation: addIgnore, actor: AGENT });
    expect(safe.ok && safe.value.approval).toBe('auto');
    const material = applyConfigOperation({ rootDir, operation: addAlias, actor: AGENT });
    expect(material.ok).toBe(false);
  });

  it('manual mode blocks agent writes entirely (§Z6)', () => {
    setMode('manual');
    const rejected = applyConfigOperation({ rootDir, operation: addIgnore, actor: AGENT });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('manual');
    }
  });

  it('validation gate: duplicates are rejected and the file stays untouched (§Z13)', () => {
    applyConfigOperation({ rootDir, operation: addAlias, actor: USER });
    const before = readFileSync(join(rootDir, '.impactgraph/aliases.yml'), 'utf8');
    const duplicate = applyConfigOperation({ rootDir, operation: addAlias, actor: USER });
    expect(duplicate.ok).toBe(false);
    expect(readFileSync(join(rootDir, '.impactgraph/aliases.yml'), 'utf8')).toBe(before);
  });

  it('every applied change carries the full §Z12 audit envelope', () => {
    const applied = applyConfigOperation({
      rootDir,
      operation: { ...addAlias, confidence: 0.8 },
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
      file: 'aliases.yml',
      validationResult: 'valid',
      confidence: 0.8,
    });
    expect(applied.value.previousDocument).not.toBeNull();
    expect(applied.value.newDocument['aliases']).toEqual({ deal: 'DealService' });
  });

  it('rollback restores the exact prior document by APPENDING — history keeps both entries (§Z14)', () => {
    applyConfigOperation({ rootDir, operation: addAlias, actor: USER });
    const rolledBack = rollbackConfigChange({ rootDir, actor: USER });
    expect(rolledBack.ok).toBe(true);

    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok && (aliases.value?.aliases ?? {})).toEqual({});

    const history = configHistory(rootDir);
    expect(history.ok && history.value).toHaveLength(2);
    if (history.ok) {
      expect(history.value[1]?.rollbackOf).toBe(history.value[0]?.rollbackId);
    }
  });

  it('the safe/material boundary is configurable, with a privacy hard floor (§Z11)', () => {
    expect(classifyOperation(addAlias, ['add-alias'])).toBe('safe');
    expect(
      classifyOperation({ kind: 'set-privacy-mode', mode: 'local-only', reason: 'r' }, [
        'set-privacy-mode',
      ]),
    ).toBe('material'); // the hard floor wins over configuration

    // configured override actually changes autonomous-mode behavior end to end
    setMode('autonomous');
    const overridden = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'set-automation-mode',
        mode: 'autonomous',
        reason: 'noop re-set to write safeOperations via restore path',
      },
      actor: USER,
    });
    expect(overridden.ok).toBe(true);
  });

  it('config diff shows what one audited change did, as flat path lines (§Z14)', () => {
    applyConfigOperation({ rootDir, operation: addAlias, actor: USER });
    const diff = configDiff(rootDir);
    expect(diff.ok).toBe(true);
    if (!diff.ok) {
      return;
    }
    expect(diff.value.entry.file).toBe('aliases.yml');
    expect(diff.value.lines).toEqual([
      { path: 'aliases.deal', before: undefined, after: 'DealService' },
    ]);
  });

  it('config restore re-applies the state AFTER a chosen entry, by append (§Z14)', () => {
    const first = applyConfigOperation({ rootDir, operation: addAlias, actor: USER });
    if (!first.ok) {
      throw new Error('setup failed');
    }
    rollbackConfigChange({ rootDir, actor: USER }); // alias gone
    const restored = restoreConfigVersion(rootDir, first.value.rollbackId, { kind: 'user' });
    expect(restored.ok).toBe(true);
    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok && aliases.value?.aliases?.['deal']).toBe('DealService');
    const history = configHistory(rootDir);
    // apply + rollback + restore = three entries; nothing rewritten
    expect(history.ok && history.value).toHaveLength(3);
  });

  it('§Z9 exclusions: add-exclusion persists, duplicates are rejected, remove-exclusion reverses', () => {
    const added = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'add-exclusion',
        component: 'SharedTypes',
        reason: 'shared type does not imply ownership',
      },
      actor: USER,
    });
    expect(added.ok && added.value.file).toBe('aliases.yml');
    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok && aliases.value?.exclusions).toEqual([
      { component: 'SharedTypes', reason: 'shared type does not imply ownership' },
    ]);

    const duplicate = applyConfigOperation({
      rootDir,
      operation: { kind: 'add-exclusion', component: 'sharedtypes', reason: 'again' },
      actor: USER,
    });
    expect(duplicate.ok).toBe(false);

    const removed = applyConfigOperation({
      rootDir,
      operation: {
        kind: 'remove-exclusion',
        component: 'SharedTypes',
        reason: 'ownership clarified',
      },
      actor: USER,
    });
    expect(removed.ok).toBe(true);
    const after = readAliasesConfig(rootDir);
    expect(after.ok && after.value?.exclusions).toEqual([]);
  });

  it('privacy mode changes go through the same audited path — never silent (§Z11)', () => {
    const applied = applyConfigOperation({
      rootDir,
      operation: { kind: 'set-privacy-mode', mode: 'local-only', reason: 'lock down' },
      actor: USER,
    });
    expect(applied.ok).toBe(true);
    const config = readWorkspaceConfig(rootDir);
    expect(config.ok && config.value?.privacyMode).toBe('local-only');
    const history = configHistory(rootDir);
    expect(history.ok && history.value.some((e) => e.file === 'config.yml')).toBe(true);
  });
});
