import { normalizePath } from '../typescript/module-resolution.js';

import type { ModuleResolver } from '../typescript/module-resolution.js';

// Python module-specifier resolution against the scanned file set. Pure — no filesystem access,
// no `sys.path`, no interpreter (PRD §35). A specifier that points outside the scanned files
// (standard library, site-packages) resolves to undefined and is skipped, never guessed.

const relativePrefixLength = (specifier: string): number => {
  let dots = 0;
  while (specifier[dots] === '.') {
    dots += 1;
  }
  return dots;
};

const packageDirOf = (fromFilePath: string): string =>
  fromFilePath.includes('/') ? fromFilePath.slice(0, fromFilePath.lastIndexOf('/')) : '';

const relativeStem = (fromFilePath: string, specifier: string): string => {
  const dots = relativePrefixLength(specifier);
  // One dot is the current package; each extra dot climbs one level.
  const up = '../'.repeat(dots - 1);
  const tail = specifier.slice(dots).split('.').join('/');
  return normalizePath(`${packageDirOf(fromFilePath)}/${up}${tail}`);
};

/**
 * The repository-relative path stems a Python import specifier can denote, most specific first.
 * `app.routers.deals` → ['app/routers/deals']; with source roots, also '<root>/app/routers/deals'.
 * Exported so a Python framework adapter can match a specifier to a file without re-implementing
 * Python's module conventions (PRD §C14 — language knowledge stays in the language package).
 */
export const pythonModuleStems = (
  fromFilePath: string,
  specifier: string,
  sourceRoots: readonly string[] = [''],
): readonly string[] => {
  if (specifier.startsWith('.')) {
    return [relativeStem(fromFilePath, specifier)];
  }
  const absolute = specifier.split('.').join('/');
  return sourceRoots.map((root) => normalizePath(`${root}/${absolute}`));
};

const candidatesFor = (stem: string): readonly string[] => [`${stem}.py`, `${stem}/__init__.py`];

/**
 * Resolve a Python import specifier to a repository-relative file path. `sourceRoots` lets a
 * project whose packages live under e.g. `src/` resolve absolute imports; the repository root is
 * always tried.
 */
export const createPythonModuleResolver = (
  filePaths: ReadonlySet<string>,
  sourceRoots: readonly string[] = [''],
): ModuleResolver => {
  const roots = sourceRoots.includes('') ? sourceRoots : ['', ...sourceRoots];
  return (fromFilePath, specifier) => {
    for (const stem of pythonModuleStems(fromFilePath, specifier, roots)) {
      for (const candidate of candidatesFor(stem)) {
        if (filePaths.has(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  };
};
