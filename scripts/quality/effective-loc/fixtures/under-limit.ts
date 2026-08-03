// under-limit.ts — fixture for the effective-LOC analyzer.
// Expected effective lines: 10 (imports, comments, blanks, and brace-only lines excluded).
import { join } from 'node:path';
import {
  readFileSync,
} from 'node:fs';

/**
 * Reads a file relative to a base directory.
 */
export function readRelative(base: string, name: string): string {
  const fullPath = join(base, name);
  return readFileSync(fullPath, 'utf8'); // trailing comment: the line still counts
}

export const marker = `template with // marker inside`;

export interface Options {
  base: string;
  name: string;
}

export function describeOptions(options: Options): string {
  return `${options.base}/${options.name}`;
}

// The closing braces above are punctuation-only lines and do not count.
export const total = 1 + 2 + 3;
