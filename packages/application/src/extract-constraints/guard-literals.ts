/**
 * Reading the two things every guard script has: what it forbids, and what it excuses.
 *
 * Deliberately shallow. These are lexical readings of literal collections and literal patterns —
 * no evaluation, no interpretation of control flow. A guard that computes its allowlist at runtime
 * is not understood, and must be reported as opaque rather than half-read, because a half-read
 * allowlist produces exactly the false-positive blocking finding this system must never emit.
 */

/** A named collection literal found in a guard: `ALLOWLIST = [...]`, `const ALLOWED = new Set([...])`. */
export interface CollectionLiteral {
  readonly name: string;
  readonly values: readonly string[];
  readonly line: number;
}

const ALLOW_NAMES = /^(allow|allowed|allowlist|whitelist|exempt|exemptions|permitted|exceptions)/i;
const DENY_NAMES = /^(deny|denied|denylist|blacklist|forbidden|banned|prohibited|disallowed)/i;

const lineOf = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length;

/**
 * Collection literals assigned to an upper-snake or camel identifier, in Python, TS/JS or shell.
 * Only literal string members are read; a non-literal member makes the collection unreadable and
 * the caller is told by way of a shorter list than the source implies — which is why the extractor
 * refuses to build exemptions from a collection containing anything it could not read.
 */
export const readCollectionLiterals = (content: string): readonly CollectionLiteral[] => {
  const results: CollectionLiteral[] = [];
  const assignment =
    /(?:const|let|var|readonly)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(?:new\s+Set\s*\(\s*)?[[{(]([\s\S]{0,2000}?)[\]})]/g;
  let match: RegExpExecArray | null = assignment.exec(content);
  while (match !== null) {
    const [, name = '', body = ''] = match;
    const values = [...body.matchAll(/["']([^"'\n]+)["']/g)].map((entry) => entry[1] ?? '');
    // A collection whose body contains non-literal members is only partly readable. Recording the
    // literals anyway would silently narrow an allowlist, so the whole collection is skipped.
    const nonLiteral = /[A-Za-z_][A-Za-z0-9_]*\s*(?:\(|\.)/.test(body.replace(/["'][^"'\n]*["']/g, ''));
    if (values.length > 0 && !nonLiteral) {
      results.push({ name, values, line: lineOf(content, match.index) });
    }
    match = assignment.exec(content);
  }
  return results;
};

export const allowCollections = (
  collections: readonly CollectionLiteral[],
): readonly CollectionLiteral[] => collections.filter((entry) => ALLOW_NAMES.test(entry.name));

export const denyCollections = (
  collections: readonly CollectionLiteral[],
): readonly CollectionLiteral[] => collections.filter((entry) => DENY_NAMES.test(entry.name));

/** A pattern the guard matches on: a compiled regex literal or a plain search string. */
export interface GuardPattern {
  readonly source: string;
  readonly line: number;
}

const PATTERN_SITES = [
  /re\.compile\(\s*r?["']([^"'\n]{3,200})["']/g,
  /new RegExp\(\s*["']([^"'\n]{3,200})["']/g,
  /\/((?:[^/\\\n]|\\.){4,200})\/[gimsuy]*\.test\(/g,
];

export const readGuardPatterns = (content: string): readonly GuardPattern[] => {
  const results: GuardPattern[] = [];
  for (const site of PATTERN_SITES) {
    const regex = new RegExp(site.source, site.flags);
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
      results.push({ source: match[1] ?? '', line: lineOf(content, match.index) });
      match = regex.exec(content);
    }
  }
  return results;
};

/** Directory literals the guard walks, which become the constraint's scope. */
export const readScopedDirectories = (content: string): readonly string[] => {
  const sites = [
    /Path\(\s*["']([^"'\n]+)["']\s*\)/g,
    /(?:rglob|glob|walk|iterdir)\(\s*["']?([^"'\n)]*)["']?\s*\)/g,
    /(?:SERVICE_DIRS?|SOURCE_DIRS?|ROOTS?|SCAN_DIRS?)\s*=\s*["']([^"'\n]+)["']/g,
  ];
  const found = new Set<string>();
  for (const site of sites) {
    for (const match of content.matchAll(site)) {
      const value = (match[1] ?? '').trim();
      if (value.length > 0 && !value.startsWith('*') && !value.includes('..')) {
        found.add(value.replace(/\/$/, ''));
      }
    }
  }
  return [...found].sort();
};

/** True when the guard can fail the build — the difference between a check and a report. */
export const failsTheBuild = (content: string): boolean =>
  /sys\.exit\(\s*[1-9]|process\.exit\(\s*[1-9]|exit\s+[1-9]|raise\s+SystemExit|assert\s|throw new Error/.test(
    content,
  );
