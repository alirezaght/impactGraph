import { globToRegExp } from './ignore.js';

// `.gitignore` support (PRD §40.1). A repository already states which paths are not source —
// build output, virtualenvs, tool caches — and restating that in `.impactgraph/config.yml` is
// work the user should not have to redo. Honoured for the common subset of the format:
// comments, negation, directory-only patterns, and anchoring. Character classes and `\`
// escapes are not interpreted; a pattern using them simply matches nothing rather than
// matching the wrong thing.

export interface GitignoreRule {
  readonly regex: RegExp;
  /** `!pattern` — re-includes a path an earlier rule ignored. */
  readonly negated: boolean;
  /** `pattern/` — applies to directories only, never to a file of the same name. */
  readonly directoryOnly: boolean;
}

/** Trailing whitespace is not part of a pattern unless escaped; git treats it as insignificant. */
const stripTrailingSpace = (line: string): string => line.replace(/(?<!\\)\s+$/, '');

const toRule = (rawLine: string, baseDir: string): GitignoreRule | undefined => {
  const line = stripTrailingSpace(rawLine);
  if (line === '' || line.startsWith('#')) {
    return undefined;
  }
  const negated = line.startsWith('!');
  const withoutBang = negated ? line.slice(1) : line;
  const directoryOnly = withoutBang.endsWith('/');
  const body = directoryOnly ? withoutBang.slice(0, -1) : withoutBang;
  if (body === '') {
    return undefined;
  }
  // Anchored when the pattern names a path (leading or interior slash); otherwise it floats and
  // matches at any depth below the directory the .gitignore lives in — git's rule exactly.
  const anchored = body.startsWith('/') || body.includes('/');
  const pattern = body.startsWith('/') ? body.slice(1) : body;
  const prefix = baseDir === '' ? '' : `${baseDir}/`;
  return {
    regex: globToRegExp(anchored ? `${prefix}${pattern}` : `${prefix}**/${pattern}`),
    negated,
    directoryOnly,
  };
};

/** Parse one `.gitignore`. `baseDir` is its directory, repository-relative ('' at the root). */
export const parseGitignore = (contents: string, baseDir: string): GitignoreRule[] => {
  const rules: GitignoreRule[] = [];
  for (const line of contents.split('\n')) {
    const rule = toRule(line, baseDir);
    if (rule !== undefined) {
      rules.push(rule);
    }
  }
  return rules;
};

/**
 * Last matching rule wins, so a negation only re-includes what precedes it. Rules arrive in
 * file order, and rules from a nested `.gitignore` are appended after their parent's — which is
 * what makes the deeper file override the shallower one.
 */
export const matchesGitignore = (
  rules: readonly GitignoreRule[],
  relativePath: string,
  isDirectory: boolean,
): boolean => {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) {
      continue;
    }
    if (rule.regex.test(relativePath)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
};
