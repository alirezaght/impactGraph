import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { matchesGitignore, parseGitignore } from './gitignore.js';
import { createIgnoreMatcher } from './ignore.js';

import type { GitignoreRule } from './gitignore.js';

// Workspace scanner (PRD §15.1, §40.1, §42.5). Repository content is untrusted: symlinks are
// never followed out of the root, directory symlinks are not traversed (cycle-proof), and
// oversized files are skipped with a recorded warning. Never executes repository code.

const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000;

export interface ScanOptions {
  readonly ignoreGlobs?: readonly string[];
  readonly maxFileSizeBytes?: number;
  /** Honour `.gitignore` files found while walking (default true, PRD §40.1). */
  readonly respectGitignore?: boolean;
}

export interface ScannedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sizeBytes: number;
}

export interface ScanWarning {
  readonly path: string;
  readonly reason: 'oversized' | 'symlink-outside-root' | 'symlink-directory' | 'unreadable';
}

/** One entry-point path declared in a package manifest (main/module/bin/exports — §15.1). */
export interface ManifestEntryPoint {
  readonly configKey: 'main' | 'module' | 'bin' | 'exports';
  /** Path as declared, relative to the package directory, with any leading './' stripped. */
  readonly path: string;
}

/** One dependency declared in a package manifest (§15.1) — the name as a spec would write it. */
export interface ManifestDependency {
  readonly name: string;
  readonly versionRange: string;
  readonly configKey: string;
}

export interface PackageInfo {
  readonly name: string;
  readonly relativeDir: string;
  readonly manifestPath: string;
  readonly workspaces: readonly string[];
  readonly entryPoints: readonly ManifestEntryPoint[];
  readonly dependencies: readonly ManifestDependency[];
}

export interface ScanResult {
  readonly files: readonly ScannedFile[];
  readonly warnings: readonly ScanWarning[];
  readonly packages: readonly PackageInfo[];
  readonly ignoredCount: number;
}

interface ScanState {
  readonly rootReal: string;
  readonly maxSize: number;
  readonly matcher: ReturnType<typeof createIgnoreMatcher>;
  readonly respectGitignore: boolean;
  readonly files: ScannedFile[];
  readonly warnings: ScanWarning[];
  readonly packages: PackageInfo[];
  ignoredCount: number;
}

const collectStringLeaves = (value: unknown, out: string[]): void => {
  if (typeof value === 'string') {
    out.push(value);
  } else if (value !== null && typeof value === 'object') {
    // bin/exports maps (arbitrarily nested for export conditions) — every string leaf is a path.
    for (const nested of Object.values(value)) {
      collectStringLeaves(nested, out);
    }
  }
};

const ENTRY_POINT_KEYS = ['main', 'module', 'bin', 'exports'] as const;

const readEntryPoints = (manifest: Record<string, unknown>): ManifestEntryPoint[] => {
  const entries: ManifestEntryPoint[] = [];
  for (const configKey of ENTRY_POINT_KEYS) {
    const leaves: string[] = [];
    collectStringLeaves(manifest[configKey], leaves);
    for (const leaf of leaves) {
      const path = leaf.startsWith('./') ? leaf.slice(2) : leaf;
      if (path !== '' && !path.startsWith('.') && !entries.some((e) => e.path === path)) {
        entries.push({ configKey, path });
      }
    }
  }
  return entries;
};

const DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/**
 * Declared dependencies, first declaration winning. A native binding, a bundler, or a packaging
 * tool is named in a specification the way the manifest names it — so the manifest is where that
 * name has to become addressable.
 */
const readDependencies = (manifest: Record<string, unknown>): ManifestDependency[] => {
  const dependencies: ManifestDependency[] = [];
  const seen = new Set<string>();
  for (const configKey of DEPENDENCY_KEYS) {
    const block = manifest[configKey];
    if (block === null || typeof block !== 'object') {
      continue;
    }
    for (const [name, versionRange] of Object.entries(block)) {
      if (name !== '' && typeof versionRange === 'string' && !seen.has(name)) {
        seen.add(name);
        dependencies.push({ name, versionRange, configKey: `${configKey}.${name}` });
      }
    }
  }
  return dependencies;
};

const readPackageManifest = (state: ScanState, absolute: string, relative: string): void => {
  try {
    const manifest = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown> & {
      name?: string;
      workspaces?: string[] | { packages?: string[] };
    };
    const workspaces = Array.isArray(manifest.workspaces)
      ? manifest.workspaces
      : (manifest.workspaces?.packages ?? []);
    const relativeDir = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
    state.packages.push({
      name: manifest.name ?? (relativeDir === '' ? 'root' : relativeDir),
      relativeDir,
      manifestPath: relative,
      workspaces,
      entryPoints: readEntryPoints(manifest),
      dependencies: readDependencies(manifest),
    });
  } catch {
    state.warnings.push({ path: relative, reason: 'unreadable' });
  }
};

const visitFile = (state: ScanState, absolute: string, relative: string, isLink: boolean): void => {
  if (state.matcher.ignoresFile(relative)) {
    state.ignoredCount += 1;
    return;
  }
  try {
    if (isLink && !realpathSync(absolute).startsWith(state.rootReal)) {
      state.warnings.push({ path: relative, reason: 'symlink-outside-root' });
      return;
    }
    const size = statSync(absolute).size;
    if (size > state.maxSize) {
      state.warnings.push({ path: relative, reason: 'oversized' });
      return;
    }
    state.files.push({ relativePath: relative, absolutePath: absolute, sizeBytes: size });
    if (relative === 'package.json' || relative.endsWith('/package.json')) {
      readPackageManifest(state, absolute, relative);
    }
  } catch {
    state.warnings.push({ path: relative, reason: 'unreadable' });
  }
};

/**
 * Rules from this directory's `.gitignore`, appended after the inherited ones so a nested file
 * overrides its parent. An unreadable `.gitignore` contributes nothing rather than failing the
 * scan — repository content is untrusted input, never a precondition.
 */
const gitignoreRulesFor = (
  state: ScanState,
  absoluteDir: string,
  relativeDir: string,
  inherited: readonly GitignoreRule[],
): readonly GitignoreRule[] => {
  if (!state.respectGitignore) {
    return inherited;
  }
  let contents: string;
  try {
    contents = readFileSync(join(absoluteDir, '.gitignore'), 'utf8');
  } catch {
    return inherited;
  }
  const local = parseGitignore(contents, relativeDir);
  return local.length === 0 ? inherited : [...inherited, ...local];
};

const walk = (
  state: ScanState,
  absoluteDir: string,
  relativeDir: string,
  inheritedRules: readonly GitignoreRule[],
): void => {
  const rules = gitignoreRulesFor(state, absoluteDir, relativeDir, inheritedRules);
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const absolute = join(absoluteDir, entry.name);
    const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    const isLink = entry.isSymbolicLink();
    const isDirectory = entry.isDirectory() || (isLink && safeIsDirectory(absolute));
    if (isDirectory) {
      if (isLink) {
        // Never traverse directory symlinks: cycle-proof and containment-proof (PRD §42.5).
        state.warnings.push({ path: relative, reason: 'symlink-directory' });
      } else if (
        state.matcher.ignoresDirectory(relative) ||
        matchesGitignore(rules, relative, true)
      ) {
        state.ignoredCount += 1;
      } else {
        walk(state, absolute, relative, rules);
      }
    } else if (matchesGitignore(rules, relative, false)) {
      state.ignoredCount += 1;
    } else {
      visitFile(state, absolute, relative, isLink);
    }
  }
};

const safeIsDirectory = (absolute: string): boolean => {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false; // broken symlink
  }
};

export const scanWorkspace = (rootDir: string, options: ScanOptions = {}): ScanResult => {
  const state: ScanState = {
    rootReal: realpathSync(rootDir),
    maxSize: options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    matcher: createIgnoreMatcher(options.ignoreGlobs ?? []),
    respectGitignore: options.respectGitignore ?? true,
    files: [],
    warnings: [],
    packages: [],
    ignoredCount: 0,
  };
  walk(state, state.rootReal, '', []);
  return {
    files: state.files,
    warnings: state.warnings,
    packages: state.packages,
    ignoredCount: state.ignoredCount,
  };
};
