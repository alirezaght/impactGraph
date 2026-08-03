import { describe, expect, it } from 'vitest';

import { resolveWorkspaceSpecifier, workspacePackages } from './workspace-packages.js';

import type { RepositoryFile } from '@impactgraph/language-adapters';

// §15.1 monorepo support. The failure this guards against is silent: without workspace
// resolution every cross-package import simply produces no edge, and the graph looks like
// several unrelated folders rather than one system.

const file = (relativePath: string, content: string): RepositoryFile => ({
  relativePath,
  content,
});

const FILES: readonly RepositoryFile[] = [
  file('package.json', '{"name":"root","workspaces":["packages/*"]}'),
  file('packages/core/package.json', '{"name":"@fixture/core","main":"./src/index.ts"}'),
  file('packages/core/src/index.ts', 'export const a = 1;'),
  file('packages/core/src/utils.ts', 'export const b = 2;'),
  // declares no `main` — the conventional entry must still be found
  file('packages/plain/package.json', '{"name":"@fixture/plain"}'),
  file('packages/plain/src/index.ts', 'export const c = 3;'),
  file('packages/broken/package.json', '{ this is not json'),
  file('packages/nameless/package.json', '{"version":"1.0.0"}'),
];

const paths = new Set(FILES.map((entry) => entry.relativePath));
const packages = workspacePackages(FILES, paths);
const resolve = (specifier: string): string | undefined =>
  resolveWorkspaceSpecifier(packages, paths, specifier);

describe('workspace-package resolution (§15.1)', () => {
  it('resolves a package name to its declared entry file', () => {
    expect(resolve('@fixture/core')).toBe('packages/core/src/index.ts');
  });

  it('falls back to the conventional entry when the manifest declares no main', () => {
    expect(resolve('@fixture/plain')).toBe('packages/plain/src/index.ts');
  });

  it('resolves a subpath RELATIVE TO THE PACKAGE ROOT, as Node does — not into src/', () => {
    // `@fixture/core/src/utils` is the specifier Node resolves; `@fixture/core/utils` would need
    // an `exports` map to redirect it, and silently guessing `src/` would invent a resolution the
    // package never declared (and would then attach edges to the wrong file).
    expect(resolve('@fixture/core/src/utils')).toBe('packages/core/src/utils.ts');
    expect(resolve('@fixture/core/utils')).toBeUndefined();
  });

  it('a third-party specifier resolves to NOTHING — it is not part of the analyzed system', () => {
    expect(resolve('react')).toBeUndefined();
    expect(resolve('@types/node')).toBeUndefined();
  });

  it('relative and absolute specifiers are left to the language resolver', () => {
    expect(resolve('./sibling')).toBeUndefined();
    expect(resolve('/etc/passwd')).toBeUndefined();
  });

  it('an unparseable or nameless manifest is skipped, never guessed at', () => {
    expect([...packages.keys()].sort()).toEqual(['@fixture/core', '@fixture/plain', 'root']);
  });

  it('cannot escape the scanned set: a subpath outside it resolves to nothing (§42.5)', () => {
    expect(resolve('@fixture/core/../../../etc/passwd')).toBeUndefined();
    expect(resolve('@fixture/core/missing')).toBeUndefined();
  });
});
