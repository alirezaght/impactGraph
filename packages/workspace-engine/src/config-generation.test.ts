import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readArchitectureConfig } from '@impactgraph/persistence';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { detectConfigDrift } from './config-drift.js';
import { detectStack, generateConfiguration } from './config-generation.js';
import { performIndexRun } from './indexing.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

// Story 14.1 — the §Z1 onboarding flow end to end: inspect → index facts → generate config →
// validate → first analysis, with ZERO manual config edits (§Z19.1/§Z19.12).

describe('detection-first configuration (Story 14.1, §Z1/§Z4)', () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-gen-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'gen@test.dev');
    git('config', 'user.name', 'Gen');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('detect_stack reports languages, frameworks, and convention signals from evidence (§Z4)', async () => {
    const stack = await detectStack(repoDir);
    expect(stack.ok).toBe(true);
    if (!stack.ok) {
      return;
    }
    expect(stack.value.languages).toContain('typescript');
    expect(stack.value.languages).toContain('prisma');
    expect(stack.value.frameworks).toContain('prisma');
    expect(stack.value.signals).toContain('migrations');
    expect(stack.value.signals).toContain('docker');
    expect(stack.value.signals).toContain('ci');
  });

  it('generate → validated config → clean drift → first analysis, zero manual edits (§Z1)', async () => {
    const generated = await generateConfiguration(repoDir, { kind: 'user' });
    expect(generated.ok).toBe(true);
    if (!generated.ok) {
      return;
    }
    // the uncovered package became a context via the governed path
    expect(generated.value.applied.some((item) => item.kind === 'uncovered-package')).toBe(true);
    const architecture = readArchitectureConfig(repoDir);
    expect(architecture.ok && (architecture.value?.contexts?.length ?? 0)).toBeGreaterThan(0);

    // drift is clean afterward (nothing else to fix)
    const drift = await detectConfigDrift(repoDir);
    expect(drift.ok && drift.value.suggestions).toEqual([]);

    // first analysis runs with zero manual config edits
    writeFileSync(
      join(repoDir, 'onboarding.md'),
      '# Onboarding\nDealService must filter expired deals from search results.\n',
    );
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'onboarding.md',
      rawText: '# Onboarding\nDealService must filter expired deals from search results.\n',
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
    expect(built.ok && built.value.analysis.requirementImpacts.length).toBeGreaterThan(0);
  });
});
