import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createIgnoreMatcher } from './ignore.js';

// Workspace scanner (PRD §15.1, §40.1, §42.5). Repository content is untrusted: symlinks are
// never followed out of the root, directory symlinks are not traversed (cycle-proof), and
// oversized files are skipped with a recorded warning. Never executes repository code.

const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000;

export interface ScanOptions {
  readonly ignoreGlobs?: readonly string[];
  readonly maxFileSizeBytes?: number;
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

export interface PackageInfo {
  readonly name: string;
  readonly relativeDir: string;
  readonly manifestPath: string;
  readonly workspaces: readonly string[];
  readonly entryPoints: readonly ManifestEntryPoint[];
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

const walk = (state: ScanState, absoluteDir: string, relativeDir: string): void => {
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
      } else if (state.matcher.ignoresDirectory(relative)) {
        state.ignoredCount += 1;
      } else {
        walk(state, absolute, relative);
      }
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
    files: [],
    warnings: [],
    packages: [],
    ignoredCount: 0,
  };
  walk(state, state.rootReal, '');
  return {
    files: state.files,
    warnings: state.warnings,
    packages: state.packages,
    ignoredCount: state.ignoredCount,
  };
};
