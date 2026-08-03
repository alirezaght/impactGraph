import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { analyzeEffectiveLoc } from '../src/analyzer.js';
import { run } from '../src/cli.js';

// Resolved from the repo root (vitest runs from there); avoids `import.meta`,
// which is illegal in files tsc treats as CommonJS.
const FIXTURES_DIR = path.resolve(process.cwd(), 'scripts/quality/effective-loc/fixtures');

/** Hand-verified counts; each fixture states its own in a header comment. */
const EXPECTED_EFFECTIVE: Record<string, number> = {
  'under-limit.ts': 10,
  'edge-cases.ts': 9,
  'sample.tsx': 13,
  'over-limit.ts': 305,
};

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(cwd: string, argv: string[]): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await run({
    argv,
    cwd,
    config: { includeGlobs: ['src/**/*.{ts,tsx}'], exceptionsFile: 'loc-exceptions.json' },
    writeOut: (text) => {
      stdout += text;
    },
    writeErr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

// Every root is tracked and removed: an unclean temp dir per test run adds up to thousands
// of orphaned directories in the OS temp folder over a project's life.
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(exceptions: unknown[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), 'impactgraph-loc-cli-'));
  roots.push(root);
  cpSync(FIXTURES_DIR, path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'loc-exceptions.json'),
    JSON.stringify({ exceptions }, null, 2),
    'utf8',
  );
  return root;
}

describe('fixture expected counts', () => {
  for (const [fixture, expected] of Object.entries(EXPECTED_EFFECTIVE)) {
    it(`${fixture} has exactly ${expected} effective lines`, () => {
      const sourceText = readFileSync(path.join(FIXTURES_DIR, fixture), 'utf8');
      expect(analyzeEffectiveLoc(fixture, sourceText).effectiveLines).toBe(expected);
    });
  }
});

describe('run (end-to-end against fixtures)', () => {
  it('reports the over-limit fixture with its exact effective count', async () => {
    const root = makeRoot();
    const result = await runCli(root, []);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/over-limit.ts  effective=305  max=300');
    expect(result.stdout).toContain('1 violation(s), 4 file(s) checked');
    expect(result.stdout).not.toContain('under-limit.ts  effective=');
  });

  it('honors a valid unexpired exception', async () => {
    const root = makeRoot([
      {
        path: 'src/over-limit.ts',
        reason: 'generated fixture used in CLI tests',
        owner: 'alireza',
        reviewBy: '2999-12-31',
        maxLines: 400,
      },
    ]);
    const result = await runCli(root, []);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('0 violation(s), 4 file(s) checked');
  });

  it('emits a stable JSON report with --json', async () => {
    const root = makeRoot();
    const result = await runCli(root, ['--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      checkedFiles: 4,
      violationCount: 1,
      violations: [
        {
          path: 'src/over-limit.ts',
          effectiveLines: 305,
          totalLines: 308,
          maxLines: 300,
          exceptionApplied: false,
        },
      ],
    });
  });

  it('applies ignore globs in --files mode', async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, 'src/dist'), { recursive: true });
    cpSync(path.join(root, 'src/over-limit.ts'), path.join(root, 'src/dist/bundle.ts'));
    const ignored = await runCli(root, ['--files', 'src/dist/bundle.ts']);
    expect(ignored.code).toBe(0);
    expect(ignored.stdout).toContain('0 violation(s), 0 file(s) checked');

    const checked = await runCli(root, ['--files', 'src/over-limit.ts']);
    expect(checked.code).toBe(1);
    expect(checked.stdout).toContain('src/over-limit.ts  effective=305  max=300');
  });

  it('exits 2 on a --files path that does not exist', async () => {
    const root = makeRoot();
    const result = await runCli(root, ['--files', 'src/nope.ts']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no such file');
  });

  it('exits 2 on unknown arguments', async () => {
    const root = makeRoot();
    const result = await runCli(root, ['--nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown argument');
  });

  it('exits 1 when the exceptions file contains an expired entry', async () => {
    const root = makeRoot([
      {
        path: 'src/over-limit.ts',
        reason: 'expired on purpose',
        owner: 'alireza',
        reviewBy: '2000-01-01',
        maxLines: 400,
      },
    ]);
    const result = await runCli(root, []);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('expired');
  });
});
