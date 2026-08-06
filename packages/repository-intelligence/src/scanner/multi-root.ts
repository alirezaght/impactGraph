import { scanWorkspace } from './scanner.js';

import type { PackageInfo, ScannedFile, ScanOptions, ScanResult, ScanWarning } from './scanner.js';

/**
 * Multi-root scan (registered workspace repositories, config `repositories:`).
 *
 * Each additional root is scanned FROM ITS OWN DIRECTORY — its `.gitignore` chain starts at its
 * own top level, exactly as if it were opened alone — and its results are rebased under the
 * root's path relative to the workspace. The workspace scan excludes those directories so no file
 * is scanned twice. Everything downstream (hashing, parsing, assembly, persistence) sees one flat
 * file list with workspace-relative paths and needs no knowledge of the roster.
 */

export interface AdditionalRoot {
  readonly name: string;
  readonly rootDir: string;
  /** Posix path of the root relative to the workspace root — becomes the path prefix. */
  readonly relativePrefix: string;
}

export interface RootFileCount {
  /** `'.'` is the workspace root itself; other entries carry the registered name. */
  readonly name: string;
  readonly fileCount: number;
}

export interface MultiRootScanResult extends ScanResult {
  readonly rootFileCounts: readonly RootFileCount[];
}

const rebaseFiles = (
  files: readonly ScannedFile[],
  prefix: string,
  seen: Set<string>,
): ScannedFile[] => {
  const rebased: ScannedFile[] = [];
  for (const file of files) {
    const relativePath = `${prefix}/${file.relativePath}`;
    if (!seen.has(relativePath)) {
      seen.add(relativePath);
      rebased.push({ ...file, relativePath });
    }
  }
  return rebased;
};

const rebasePackages = (packages: readonly PackageInfo[], prefix: string): PackageInfo[] =>
  packages.map((pkg) => ({
    ...pkg,
    relativeDir: pkg.relativeDir === '' ? prefix : `${prefix}/${pkg.relativeDir}`,
    manifestPath: `${prefix}/${pkg.manifestPath}`,
  }));

const rebaseWarnings = (warnings: readonly ScanWarning[], prefix: string): ScanWarning[] =>
  warnings.map((warning) => ({ ...warning, path: `${prefix}/${warning.path}` }));

export const scanRoots = (
  rootDir: string,
  additionalRoots: readonly AdditionalRoot[],
  options: ScanOptions,
): MultiRootScanResult => {
  const prefixGlobs = additionalRoots.map((root) => `${root.relativePrefix}/**`);
  const main = scanWorkspace(rootDir, {
    ...options,
    ignoreGlobs: [...(options.ignoreGlobs ?? []), ...prefixGlobs],
  });
  const files = [...main.files];
  const warnings = [...main.warnings];
  const packages = [...main.packages];
  const rootFileCounts: RootFileCount[] = [{ name: '.', fileCount: main.files.length }];
  let ignoredCount = main.ignoredCount;
  const seen = new Set(files.map((file) => file.relativePath));
  for (const root of additionalRoots) {
    const scan = scanWorkspace(root.rootDir, options);
    const rebased = rebaseFiles(scan.files, root.relativePrefix, seen);
    files.push(...rebased);
    warnings.push(...rebaseWarnings(scan.warnings, root.relativePrefix));
    packages.push(...rebasePackages(scan.packages, root.relativePrefix));
    ignoredCount += scan.ignoredCount;
    rootFileCounts.push({ name: root.name, fileCount: rebased.length });
  }
  return { files, warnings, packages, ignoredCount, rootFileCounts };
};
