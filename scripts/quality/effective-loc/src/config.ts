/**
 * Defaults for the effective-LOC checker (ADR-0012).
 *
 * Ordinary test files are deliberately NOT ignored: tests are code we maintain
 * and are held to the same 300-effective-line limit. Only generated output,
 * third-party trees, and analyzer fixtures are excluded.
 */
export interface LocConfig {
  maxEffectiveLines: number;
  includeGlobs: readonly string[];
  ignoreGlobs: readonly string[];
  /** Repo-root-relative path to the reviewed exceptions file. */
  exceptionsFile: string;
}

export const DEFAULT_LOC_CONFIG: LocConfig = {
  maxEffectiveLines: 300,
  includeGlobs: [
    'apps/**/*.{ts,tsx,js,jsx}',
    'packages/**/*.{ts,tsx,js,jsx}',
    'scripts/**/*.{ts,tsx}',
  ],
  ignoreGlobs: [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/coverage/**',
    '**/*.gen.*',
    '**/generated/**',
    '**/.vscode-test/**',
    'packages/test-kit/fixtures/**',
    'scripts/quality/effective-loc/fixtures/**',
  ],
  exceptionsFile: 'scripts/quality/loc-exceptions.json',
};

const regExpCache = new Map<string, RegExp>();

/**
 * Converts a glob to a RegExp. Supports the subset used by the ignore globs
 * above: `**` (any path segments), `*` (within a segment), `?` (one char).
 * Brace expansion (`{ts,tsx}`) is NOT supported here — include globs go
 * through fast-glob; this matcher is only applied to ignore globs in
 * `--files` and staged-diff modes.
 */
export function globToRegExp(glob: string): RegExp {
  const cached = regExpCache.get(glob);
  if (cached !== undefined) return cached;
  let pattern = '';
  let index = 0;
  while (index < glob.length) {
    const char = glob.charAt(index);
    if (char === '*') {
      if (glob.startsWith('**/', index) && (index === 0 || glob.charAt(index - 1) === '/')) {
        pattern += '(?:.*/)?';
        index += 3;
        continue;
      }
      if (glob.startsWith('**', index)) {
        pattern += '.*';
        index += 2;
        continue;
      }
      pattern += '[^/]*';
      index += 1;
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      index += 1;
      continue;
    }
    pattern += '\\^$.|+()[]{}'.includes(char) ? `\\${char}` : char;
    index += 1;
  }
  const regExp = new RegExp(`^${pattern}$`);
  regExpCache.set(glob, regExp);
  return regExp;
}

export function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  const posixPath = filePath.replace(/\\/g, '/');
  return globs.some((glob) => globToRegExp(glob).test(posixPath));
}
