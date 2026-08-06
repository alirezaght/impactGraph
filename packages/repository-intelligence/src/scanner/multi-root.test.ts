import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { scanRoots } from './multi-root.js';

const root = mkdtempSync(join(tmpdir(), 'impactgraph-multi-root-'));

const write = (relative: string, content: string): void => {
  const absolute = join(root, relative);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
};

write('package.json', JSON.stringify({ name: 'workspace-root' }));
write('src/main.ts', 'export const main = 1;\n');
write('svc-a/package.json', JSON.stringify({ name: 'svc-a' }));
write('svc-a/src/index.ts', 'export const a = 1;\n');
write('svc-a/.gitignore', 'ignored.ts\n');
write('svc-a/src/ignored.ts', 'export const hidden = 1;\n');
write('svc-b/package.json', JSON.stringify({ name: 'svc-b' }));
write('svc-b/app.py', 'print("b")\n');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const additionalRoots = [
  { name: 'svc-a', rootDir: join(root, 'svc-a'), relativePrefix: 'svc-a' },
  { name: 'svc-b', rootDir: join(root, 'svc-b'), relativePrefix: 'svc-b' },
];

describe('scanRoots', () => {
  it('merges every root into one file list with prefixed repository-relative paths', () => {
    const result = scanRoots(root, additionalRoots, {});
    const paths = result.files.map((file) => file.relativePath).sort();
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('svc-a/src/index.ts');
    expect(paths).toContain('svc-b/app.py');
    expect(new Set(paths).size).toBe(paths.length); // no duplicates from double-scanning
  });

  it('respects each root’s own .gitignore chain', () => {
    const result = scanRoots(root, additionalRoots, {});
    expect(result.files.map((file) => file.relativePath)).not.toContain('svc-a/src/ignored.ts');
  });

  it('rebases package manifests under the root prefix', () => {
    const result = scanRoots(root, additionalRoots, {});
    const svcA = result.packages.find((pkg) => pkg.name === 'svc-a');
    expect(svcA?.relativeDir).toBe('svc-a');
    expect(svcA?.manifestPath).toBe('svc-a/package.json');
  });

  it('reports per-root file counts, the main root as "."', () => {
    const result = scanRoots(root, additionalRoots, {});
    const byName = Object.fromEntries(
      result.rootFileCounts.map((entry) => [entry.name, entry.fileCount]),
    );
    expect(byName['.']).toBeGreaterThanOrEqual(2);
    expect(byName['svc-a']).toBe(3); // package.json + .gitignore + src/index.ts (ignored.ts excluded)
    expect(byName['svc-b']).toBe(2);
  });

  it('behaves exactly like a single scan when no additional roots are given', () => {
    const result = scanRoots(root, [], {});
    const paths = result.files.map((file) => file.relativePath);
    expect(paths).toContain('svc-a/src/index.ts'); // subdirectories stay part of the root scan
    expect(result.rootFileCounts).toEqual([{ name: '.', fileCount: result.files.length }]);
  });
});
