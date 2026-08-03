import { matchesGlob } from '@impactgraph/application';
import { readWorkspaceConfig } from '@impactgraph/persistence';
import { scanWorkspace } from '@impactgraph/repository-intelligence';

// Does a configuration path glob name anything that actually exists? Used by the §Z13 gate for
// corrections that must not be silent no-ops. The file universe is the SAME one the indexer
// walks (`scanWorkspace` + the workspace ignore globs), so a glob that would never produce a
// graph node is rejected at write time rather than sitting in `architecture.yml` forever.

/**
 * `true` / `false` answer the question; `undefined` means the repository could not be read, which
 * is a different outcome from "matches nothing" and must not be reported as one.
 */
export type RepositoryGlobMatcher = (glob: string) => boolean | undefined;

/**
 * Lazily scans on first use — corrections that do not need a path check never pay for the walk,
 * and one operation never walks the tree twice.
 */
export const repositoryGlobMatcher = (rootDir: string): RepositoryGlobMatcher => {
  let paths: readonly string[] | undefined;
  let scanned = false;
  const load = (): readonly string[] | undefined => {
    if (scanned) {
      return paths;
    }
    scanned = true;
    try {
      const config = readWorkspaceConfig(rootDir);
      const ignoreGlobs = (config.ok ? config.value?.ignore : undefined) ?? [];
      paths = scanWorkspace(rootDir, { ignoreGlobs }).files.map((file) => file.relativePath);
    } catch {
      paths = undefined;
    }
    return paths;
  };
  return (glob) => {
    const files = load();
    return files === undefined ? undefined : files.some((path) => matchesGlob(path, glob));
  };
};
