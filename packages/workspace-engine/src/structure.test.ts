import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyConfigOperation } from './config-operations.js';
import { performIndexRun } from './indexing.js';
import { summarizeRepositoryStructure } from './structure.js';
import { initializeWorkspace } from './workspace.js';

import type { RepositoryStructure } from './structure.js';

// §Z7 `detect_repository_structure` — a projection of the generic-discovery facts of §15.1
// (Story 2.1): source/test roots, build config, entry points. Deterministic and read-only.

describe('repository structure summary (§Z7, PRD §15.1)', () => {
  let repoDir: string;
  let structure: RepositoryStructure;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-structure-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'structure@test.dev');
    git('config', 'user.name', 'Structure');
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
    const summarized = await summarizeRepositoryStructure(repoDir);
    if (!summarized.ok) {
      throw new Error(summarized.error.message);
    }
    structure = summarized.value;
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('projects the discovered packages with their file counts and snapshot binding', () => {
    expect(structure.snapshotId.length).toBeGreaterThan(0);
    expect(structure.packages.map((entry) => entry.name)).toEqual(['ts-basic']);
    const pkg = structure.packages[0];
    expect(pkg?.nodeId).toBe('package:ts-basic');
    expect(pkg?.directory).toBe('');
    expect(pkg?.manifestPath).toBe('package.json');
    expect(pkg?.fileCount).toBeGreaterThan(0);
    expect(structure.totals.packages).toBe(1);
  });

  it('separates conventional source roots from test roots (directory nodes)', () => {
    const pkg = structure.packages[0];
    expect(pkg?.sourceRoots).toContain('src');
    // ts-basic keeps its tests beside the sources — no conventional test root exists
    expect(pkg?.testRoots).toEqual([]);
    expect(structure.totals.sourceRoots).toBe(pkg?.sourceRoots.length);
  });

  it('reports build configuration from CONFIGURES edges — never guessed from names', () => {
    const pkg = structure.packages[0];
    expect(pkg?.buildConfigFiles).toContain('tsconfig.json');
    expect(pkg?.buildConfigFiles).toContain('Dockerfile');
    expect(structure.totals.buildConfigFiles).toBe(pkg?.buildConfigFiles.length);
  });

  it('reports only entry points that exist — a manifest claim alone is not a fact', () => {
    // ts-basic declares no main/module/bin, so the EXPOSES projection is empty.
    expect(structure.packages[0]?.entryPoints).toEqual([]);
    expect(structure.totals.entryPoints).toBe(0);
  });

  it('reports no owner until a human assigns one — ownership is never derived from the repo', async () => {
    // The fixture has git history and manifests; neither may produce an owner.
    expect(structure.packages[0]?.owner).toBeUndefined();

    const applied = applyConfigOperation({
      rootDir: repoDir,
      operation: {
        kind: 'set-component-owner',
        component: '**',
        owner: 'Platform Team',
        reason: 'the whole fixture package',
      },
      actor: { kind: 'user' },
    });
    expect(applied.ok).toBe(true);
    const resummarized = await summarizeRepositoryStructure(repoDir);
    expect(resummarized.ok && resummarized.value.packages[0]?.owner).toBe('Platform Team');
    expect(resummarized.ok && resummarized.value.packages[0]?.correctionLevels).toContain(
      'human-confirmed',
    );
  });

  it('fails typed on an unindexed workspace rather than inventing a structure', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'impactgraph-structure-empty-'));
    try {
      const initialized = initializeWorkspace(emptyDir);
      expect(initialized.ok).toBe(true);
      const summarized = await summarizeRepositoryStructure(emptyDir);
      expect(summarized.ok).toBe(false);
      expect(summarized.ok ? '' : summarized.error.message).toContain('no completed index');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
