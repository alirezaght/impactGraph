import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanWorkspace } from '../index.js';

describe('workspace scanner (Story 2.1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-scan-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'package.json'), '{"name":"scan-fixture","workspaces":["pkgs/*"]}\n');
    mkdirSync(join(dir, 'pkgs', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'pkgs', 'lib', 'package.json'), '{"name":"@scan/lib"}\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('discovers files, packages, and workspaces from manifests', () => {
    const result = scanWorkspace(dir);
    expect(result.files.map((f) => f.relativePath)).toContain('src/a.ts');
    expect(result.packages.map((p) => p.name).sort()).toEqual(['@scan/lib', 'scan-fixture']);
    expect(result.packages.find((p) => p.name === 'scan-fixture')?.workspaces).toEqual(['pkgs/*']);
  });

  it('extracts entry points from main, module, bin, and exports manifest fields (§15.1)', () => {
    writeFileSync(
      join(dir, 'pkgs', 'lib', 'package.json'),
      JSON.stringify({
        name: '@scan/lib',
        main: './src/index.ts',
        bin: { lib: 'src/cli.ts' },
        exports: { '.': { import: './src/index.ts', types: './src/index.d.ts' } },
      }),
    );
    const result = scanWorkspace(dir);
    const lib = result.packages.find((p) => p.name === '@scan/lib');
    expect(lib?.entryPoints).toEqual([
      { configKey: 'main', path: 'src/index.ts' }, // './' stripped; exports duplicate deduped
      { configKey: 'bin', path: 'src/cli.ts' },
      { configKey: 'exports', path: 'src/index.d.ts' },
    ]);
    // Packages without entry-point fields report none — never guessed.
    expect(result.packages.find((p) => p.name === 'scan-fixture')?.entryPoints).toEqual([]);
  });

  it('never reports ignored or secret paths (§40.1, §35)', () => {
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'x\n');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'bundle.js'), 'x\n');
    writeFileSync(join(dir, '.env'), 'SECRET=1\n');
    writeFileSync(join(dir, '.env.local'), 'SECRET=2\n');
    writeFileSync(join(dir, 'server.pem'), 'key\n');

    const result = scanWorkspace(dir);
    const paths = result.files.map((f) => f.relativePath);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.includes('dist/'))).toBe(false);
    expect(paths.some((p) => p.includes('.env'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.pem'))).toBe(false);
    expect(result.ignoredCount).toBeGreaterThan(0);
  });

  it('respects user-configured ignore globs', () => {
    writeFileSync(join(dir, 'src', 'a.generated.ts'), 'x\n');
    const result = scanWorkspace(dir, { ignoreGlobs: ['**/*.generated.ts'] });
    expect(result.files.some((f) => f.relativePath.endsWith('.generated.ts'))).toBe(false);
  });

  it('skips oversized files with a warning (§42.5)', () => {
    writeFileSync(join(dir, 'src', 'huge.ts'), 'x'.repeat(64));
    const result = scanWorkspace(dir, { maxFileSizeBytes: 32 });
    expect(result.files.some((f) => f.relativePath === 'src/huge.ts')).toBe(false);
    expect(result.warnings).toContainEqual({ path: 'src/huge.ts', reason: 'oversized' });
  });

  it('never follows directory symlinks — cycle-proof (§42.5)', () => {
    symlinkSync(dir, join(dir, 'src', 'loop'));
    const result = scanWorkspace(dir);
    expect(result.warnings.some((w) => w.reason === 'symlink-directory')).toBe(true);
    expect(result.files.some((f) => f.relativePath.startsWith('src/loop/'))).toBe(false);
  });

  it('refuses file symlinks that escape the workspace root (§42.5)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'impactgraph-outside-'));
    writeFileSync(join(outside, 'secret.ts'), 'export const s = 1;\n');
    symlinkSync(join(outside, 'secret.ts'), join(dir, 'src', 'escape.ts'));
    const result = scanWorkspace(dir);
    expect(result.files.some((f) => f.relativePath === 'src/escape.ts')).toBe(false);
    expect(result.warnings).toContainEqual({
      path: 'src/escape.ts',
      reason: 'symlink-outside-root',
    });
    rmSync(outside, { recursive: true, force: true });
  });
});
