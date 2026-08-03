import type { ModuleResolver } from '../typescript/module-resolution.js';

// Java import resolution against the scanned file set. Pure — no classpath, no build tool, no
// compiler (PRD §35). A specifier that points outside the scanned files (the JDK, a jar
// dependency) resolves to undefined and is skipped, never guessed.
//
// Source roots are not hardcoded. `com.example.deals.DealService` denotes the path suffix
// `com/example/deals/DealService.java`, and the scanned set is searched for a file ending in it
// — which works for `src/main/java/…`, `src/test/java/…`, a Gradle module's own root, or a flat
// layout alike. Two files matching the same suffix is an ambiguity the adapter refuses to
// resolve rather than pick a winner.

const suffixOf = (specifier: string): string => `${specifier.split('.').join('/')}.java`;

const simpleNameOf = (specifier: string): string => specifier.slice(specifier.lastIndexOf('.') + 1);

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const createJavaModuleResolver = (filePaths: ReadonlySet<string>): ModuleResolver => {
  // Bucketed by file name so a lookup never scans the whole repository.
  const byBasename = new Map<string, string[]>();
  for (const path of filePaths) {
    if (path.toLowerCase().endsWith('.java')) {
      const bucket = byBasename.get(basenameOf(path)) ?? [];
      bucket.push(path);
      byBasename.set(basenameOf(path), bucket);
    }
  }
  return (_fromFilePath, specifier) => {
    const suffix = suffixOf(specifier);
    const candidates = (byBasename.get(`${simpleNameOf(specifier)}.java`) ?? []).filter(
      (path) => path === suffix || path.endsWith(`/${suffix}`),
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  };
};
