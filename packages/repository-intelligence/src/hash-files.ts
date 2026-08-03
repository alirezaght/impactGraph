import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ParseWarning, RepositoryFile } from '@impactgraph/language-adapters';

// Hashing pass (PRD §32, §33). Every scanned file is read, hashed, and released; only the hash
// survives the loop. Holding the contents instead makes peak memory scale with repository size,
// which is the difference between indexing a large monorepo and running out of heap in the hash
// loop. The scanner already caps individual files, so one file at a time is a bounded cost.

/** A scanned file reduced to identity — no content, so an array of these is cheap to retain. */
export interface HashedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly contentHash: string;
}

export interface HashedFiles {
  readonly files: HashedFile[];
  /**
   * The only bodies assembly still needs once parsing is done: manifests answer workspace-package
   * and path-alias resolution, and they are a few kilobytes each rather than the whole repository.
   */
  readonly manifests: RepositoryFile[];
}

const MANIFEST_NAMES = ['package.json', 'tsconfig.json'] as const;

const isManifest = (relativePath: string): boolean =>
  MANIFEST_NAMES.some((name) => relativePath === name || relativePath.endsWith(`/${name}`));

export const hashFiles = (
  scanned: readonly { relativePath: string; absolutePath: string }[],
  warnings: ParseWarning[],
): HashedFiles => {
  const files: HashedFile[] = [];
  const manifests: RepositoryFile[] = [];
  for (const entry of scanned) {
    try {
      const content = readFileSync(entry.absolutePath, 'utf8');
      files.push({
        relativePath: entry.relativePath,
        absolutePath: entry.absolutePath,
        contentHash: createHash('sha256').update(content).digest('hex'),
      });
      if (isManifest(entry.relativePath)) {
        manifests.push({ relativePath: entry.relativePath, content });
      }
    } catch {
      warnings.push({
        filePath: entry.relativePath,
        adapterId: 'scanner',
        message: 'unreadable file skipped',
      });
    }
  }
  return { files, manifests };
};

/**
 * Read one file for parsing. Content is fetched here rather than carried from the hashing pass
 * so it stays alive only while its adapter runs. A file edited between the two reads is parsed
 * as it now is and cached under its earlier hash — the next run sees the mismatch and reparses.
 */
export const readForParse = (file: HashedFile): RepositoryFile | undefined => {
  try {
    return { relativePath: file.relativePath, content: readFileSync(file.absolutePath, 'utf8') };
  } catch {
    return undefined;
  }
};
