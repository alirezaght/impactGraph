import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The integration lane never opens a fixture in place: every launch gets a throwaway copy of
// packages/test-kit/fixtures/ts-basic that is git-initialized (the engine refuses to snapshot a
// non-repository) and committed, so `Review Working Tree` has a baseline to diff against.
// The fixture in packages/test-kit is read-only from here — analyzer goldens depend on it.

/** Deterministic identity so nothing in the run depends on the developer's git config. */
const GIT_SETUP: readonly (readonly string[])[] = [
  ['init', '-b', 'main'],
  ['config', 'user.email', 'integration@impactgraph.test'],
  ['config', 'user.name', 'ImpactGraph Integration'],
  ['config', 'commit.gpgsign', 'false'],
  ['add', '-A'],
  ['commit', '-m', 'fixture baseline'],
];

/** Copy `fixtureDir` into a fresh temp directory and turn it into a committed git repository. */
export const createFixtureWorkspace = (fixtureDir: string, label: string): string => {
  const workspace = mkdtempSync(join(tmpdir(), `impactgraph-${label}-`));
  cpSync(fixtureDir, workspace, { recursive: true });
  for (const args of GIT_SETUP) {
    execFileSync('git', [...args], { cwd: workspace, stdio: 'ignore' });
  }
  return workspace;
};

/** A throwaway user-data / extensions directory so runs never inherit local VS Code state. */
export const createScratchDir = (label: string): string =>
  mkdtempSync(join(tmpdir(), `impactgraph-${label}-`));
