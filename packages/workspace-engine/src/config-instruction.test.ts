import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modelProviderError } from '@impactgraph/application';
import { readAliasesConfig, readArchitectureConfig } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyInstruction } from './config-instruction.js';
import { configHistory } from './config-operations.js';
import { initializeWorkspace } from './workspace.js';

import type { ConfigInstructionTranslator } from '@impactgraph/ai-inference';
import type { NlConfigResponseDto } from '@impactgraph/contracts';

// Story 14.7 — the §Z15 example sentences, translated (stub) and applied through the SAME
// governed path as every other configuration change: ownership mode, validation, audit.

const translator = (response: NlConfigResponseDto | 'error'): ConfigInstructionTranslator => ({
  translate: () =>
    Promise.resolve(
      response === 'error'
        ? { ok: false, error: modelProviderError('provider-unavailable', 'down') }
        : { ok: true, value: response },
    ),
});

const DOMAIN_CODE: NlConfigResponseDto = {
  // "Treat everything under src/domain as domain code" (§Z15)
  operations: [
    {
      kind: 'assign-component',
      path: 'src/domain/**',
      role: 'domain',
      reason: 'user: treat everything under src/domain as domain code',
    },
  ],
};

const SYNONYM: NlConfigResponseDto = {
  // "Deal and Opportunity mean the same thing" (§Z15)
  operations: [
    {
      kind: 'add-alias',
      alias: 'opportunity',
      canonical: 'Deal',
      reason: 'user: Deal and Opportunity mean the same thing',
    },
  ],
};

describe('natural-language configuration (Story 14.7, §Z15)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-nl-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error('init failed');
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('"treat src/domain as domain code" becomes an audited assign-component', async () => {
    const outcome = await applyInstruction({
      rootDir,
      instruction: 'Treat everything under src/domain as domain code',
      translator: translator(DOMAIN_CODE),
      actor: { kind: 'user' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.results[0]?.status).toBe('applied');
    const architecture = readArchitectureConfig(rootDir);
    expect(architecture.ok && architecture.value?.components?.[0]).toMatchObject({
      path: 'src/domain/**',
      role: 'domain',
    });
    const history = configHistory(rootDir);
    expect(history.ok && history.value).toHaveLength(1);
  });

  it('synonym instructions are MATERIAL — an agent without approval is rejected (§Z11)', async () => {
    const rejected = await applyInstruction({
      rootDir,
      instruction: 'Deal and Opportunity mean the same thing',
      translator: translator(SYNONYM),
      actor: { kind: 'agent', agentId: 'test' },
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) {
      return;
    }
    expect(rejected.value.results[0]?.status).toBe('rejected');
    expect(rejected.value.results[0]?.classification).toBe('material');
    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok).toBe(true);
    if (aliases.ok) {
      expect(aliases.value?.aliases ?? {}).toEqual({});
    }
  });

  it('with explicit approval the synonym becomes an alias', async () => {
    const approved = await applyInstruction({
      rootDir,
      instruction: 'Deal and Opportunity mean the same thing',
      translator: translator(SYNONYM),
      actor: { kind: 'agent', agentId: 'test' },
      approvedByUser: true,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      return;
    }
    expect(approved.value.results[0]?.status).toBe('applied');
    const aliases = readAliasesConfig(rootDir);
    expect(aliases.ok).toBe(true);
    if (aliases.ok) {
      expect(aliases.value?.aliases?.['opportunity']).toBe('Deal');
    }
  });

  it('unexpressible instructions are surfaced, never approximated', async () => {
    const outcome = await applyInstruction({
      rootDir,
      instruction: 'Deploy everything to production at midnight',
      translator: translator({
        operations: [],
        unsupported: 'deployment scheduling is not a configuration concept',
      }),
      actor: { kind: 'user' },
    });
    expect(outcome.ok && outcome.value.results).toEqual([]);
    expect(outcome.ok && outcome.value.unsupported).toContain('deployment scheduling');
  });

  it('provider failure is a typed error; nothing is written', async () => {
    const outcome = await applyInstruction({
      rootDir,
      instruction: 'anything',
      translator: translator('error'),
      actor: { kind: 'user' },
    });
    expect(outcome.ok).toBe(false);
    const history = configHistory(rootDir);
    expect(history.ok && history.value).toEqual([]);
  });
});
