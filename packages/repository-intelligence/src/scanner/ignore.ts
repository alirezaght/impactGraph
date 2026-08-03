// Glob-based ignore engine. Dependency-free: a small, conservative glob-to-regex conversion
// supporting '**', '*', and '?'. Patterns match repository-relative posix paths.

/**
 * Default ignores (PRD §40.1) — generated/dependency directories never appear in results.
 * The list is deliberately polyglot: a Python service's `.venv` and a Java module's `target`
 * are dependency and build output exactly as `node_modules` and `dist` are, and a repository
 * that mixes stacks would otherwise be scanned an order of magnitude wider than its source.
 */
export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
  // JavaScript / TypeScript
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/generated/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.astro/**',
  '**/.turbo/**',
  // Python
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.ruff_cache/**',
  '**/.tox/**',
  '**/*.egg-info/**',
  // JVM / Rust
  '**/target/**',
  '**/.gradle/**',
  // Vendored dependencies (Go, PHP, Ruby)
  '**/vendor/**',
  // Tooling state
  '**/.terraform/**',
  '**/.git/**',
  '**/.vscode-test/**',
  '**/.cache/**',
  '**/.impactgraph/cache/**',
  // Agent worktrees are full copies of the repository — scanning them multiplies it.
  '**/.claude/worktrees/**',
];

/** Secret material is excluded by default (PRD §35); never indexed, never parsed. */
export const SECRET_FILE_GLOBS: readonly string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa',
  '**/id_ed25519',
];

export const globToRegExp = (glob: string): RegExp => {
  let pattern = '';
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === '*') {
      if (glob.startsWith('**/', index)) {
        pattern += '(?:[^/]+/)*';
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
    } else if (char !== undefined) {
      pattern += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
    }
    index += 1;
  }
  return new RegExp(`^${pattern}$`);
};

export interface IgnoreMatcher {
  ignoresFile(relativePath: string): boolean;
  /** True when a directory should be pruned — nothing below it is visited. */
  ignoresDirectory(relativePath: string): boolean;
}

export const createIgnoreMatcher = (userGlobs: readonly string[] = []): IgnoreMatcher => {
  const patterns = [...DEFAULT_IGNORE_GLOBS, ...SECRET_FILE_GLOBS, ...userGlobs].map(globToRegExp);
  const matches = (path: string): boolean => patterns.some((pattern) => pattern.test(path));
  return {
    ignoresFile: matches,
    // Probe a hypothetical child so 'dir/**' patterns prune 'dir' itself.
    ignoresDirectory: (relativePath) => matches(relativePath) || matches(`${relativePath}/x`),
  };
};
