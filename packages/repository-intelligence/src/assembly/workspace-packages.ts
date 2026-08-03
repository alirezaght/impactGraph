import type { ModuleResolver, RepositoryFile } from '@impactgraph/language-adapters';

// Workspace-package resolution (§15.1 monorepo, §42.2 monorepo fixture). In a monorepo,
// `import { isExpired } from '@fixture/core'` is not a relative path and not a tsconfig alias —
// it names a SIBLING PACKAGE, resolved by the package manager through the workspace link. Without
// this, every cross-package edge in every monorepo is silently missing, which is the difference
// between analyzing one repository and analyzing several unrelated folders.
//
// Resolution is deliberately narrow: only names declared by a manifest INSIDE the scanned file
// set can match. `import 'react'` finds no manifest and resolves to nothing — a third-party
// package is not part of the analyzed system, and inventing a node for it would be a fact the
// repository never stated.

interface ManifestShape {
  readonly name?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly exports?: unknown;
}

const directoryOf = (manifestPath: string): string =>
  manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : '';

/** `./src/index.ts` → `src/index.ts`, so it can be joined onto the package directory. */
const normalizeEntry = (entry: string): string => entry.replace(/^\.\//, '');

const entryCandidates = (manifest: ManifestShape): string[] => {
  const raw = [manifest.main, manifest.module].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  // Conventional entries are probed too: a workspace package frequently declares no `main`.
  return [...raw.map(normalizeEntry), 'src/index.ts', 'index.ts', 'src/index.js', 'index.js'];
};

export interface WorkspacePackage {
  readonly name: string;
  /** Directory the manifest lives in, with a trailing slash (empty for the repository root). */
  readonly directory: string;
  /** Resolved entry file inside the scanned set, when one exists. */
  readonly entryPath?: string | undefined;
}

/** Every package declared by a manifest in the scanned set, keyed by its declared name. */
export const workspacePackages = (
  files: readonly RepositoryFile[],
  filePaths: ReadonlySet<string>,
): ReadonlyMap<string, WorkspacePackage> => {
  const byName = new Map<string, WorkspacePackage>();
  for (const file of files) {
    if (!file.relativePath.endsWith('package.json')) {
      continue;
    }
    let manifest: ManifestShape;
    try {
      manifest = JSON.parse(file.content) as ManifestShape;
    } catch {
      continue; // an unreadable manifest is the scanner's warning to raise, not ours
    }
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      continue;
    }
    const directory = directoryOf(file.relativePath);
    const entryPath = entryCandidates(manifest)
      .map((candidate) => `${directory}${candidate}`)
      .find((candidate) => filePaths.has(candidate));
    byName.set(manifest.name, {
      name: manifest.name,
      directory,
      ...(entryPath === undefined ? {} : { entryPath }),
    });
  }
  return byName;
};

/**
 * Resolve a bare specifier that names a workspace package: the package itself (`@fixture/core`)
 * or a subpath within it (`@fixture/core/utils`). Returns undefined for anything else, so the
 * caller falls through to the language resolver unchanged.
 */
export const resolveWorkspaceSpecifier = (
  packages: ReadonlyMap<string, WorkspacePackage>,
  filePaths: ReadonlySet<string>,
  specifier: string,
): string | undefined => {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return undefined;
  }
  const exact = packages.get(specifier);
  if (exact !== undefined) {
    return exact.entryPath;
  }
  // Longest-name-first so `@scope/a/b` prefers a package literally named `@scope/a/b`.
  const names = [...packages.keys()].sort((a, b) => b.length - a.length);
  const owner = names.find((name) => specifier.startsWith(`${name}/`));
  const pkg = owner === undefined ? undefined : packages.get(owner);
  if (owner === undefined || pkg === undefined) {
    return undefined;
  }
  const subpath = specifier.slice(owner.length + 1);
  const base = `${pkg.directory}${subpath}`;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`].find((candidate) =>
    filePaths.has(candidate),
  );
};

/** Wrap a language resolver so workspace-package specifiers resolve before it is consulted. */
export const withWorkspaceResolution =
  (
    inner: ModuleResolver,
    packages: ReadonlyMap<string, WorkspacePackage>,
    filePaths: ReadonlySet<string>,
  ): ModuleResolver =>
  (fromFilePath, specifier) =>
    resolveWorkspaceSpecifier(packages, filePaths, specifier) ?? inner(fromFilePath, specifier);
