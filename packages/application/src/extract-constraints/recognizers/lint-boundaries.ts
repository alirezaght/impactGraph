import type { ConstraintRecognizer, ExtractedConstraint, GuardFile } from '../types.js';

/**
 * Lint-enforced architecture: `boundaries/element-types` allow-lists and `no-restricted-imports`
 * zones.
 *
 * These are the most reliably extractable constraints in any repository, because they are already
 * declarative — the rule is data, not code. A layering rule expressed as
 * `{ from: 'application', allow: ['domain'] }` says precisely what an ONLY_ALLOWED_TO constraint
 * says, and reading it needs no interpretation at all.
 */

const CONFIG_PATH = /(^|\/)(eslint\.config\.(m?js|cjs|ts)|\.eslintrc(\.\w+)?)$/;

/** `{ type: 'domain', pattern: 'packages/domain' }` — where each element role lives on disk. */
const readElementPatterns = (content: string): ReadonlyMap<string, string> => {
  const patterns = new Map<string, string>();
  for (const match of content.matchAll(
    /\{\s*type:\s*['"]([\w-]+)['"]\s*,\s*pattern:\s*['"]([^'"]+)['"]/g,
  )) {
    const role = match[1] ?? '';
    const pattern = match[2] ?? '';
    if (role.length > 0 && pattern.length > 0 && !patterns.has(role)) {
      patterns.set(role, pattern.includes('*') ? pattern : `${pattern}/**`);
    }
  }
  return patterns;
};

const boundaryRule = (
  from: string,
  allowed: readonly string[],
  patterns: ReadonlyMap<string, string>,
  sourceLine: number,
): ExtractedConstraint => ({
  name: `${from} may only depend on ${allowed.length === 0 ? 'nothing' : allowed.join(', ')}`,
  kind: 'boundary-restriction' as const,
  severity: 'blocking' as const,
  extraction: 'recognized' as const,
  scope: { pathGlobs: [patterns.get(from) ?? '**'], roles: [from] },
  rule: {
    relation: 'ONLY_ALLOWED_TO' as const,
    targetScope: {
      pathGlobs: allowed.flatMap((role) => {
        const pattern = patterns.get(role);
        return pattern === undefined ? [] : [pattern];
      }),
      roles: [...allowed],
    },
    statement: `code in the '${from}' layer may only depend on ${allowed.length === 0 ? 'nothing' : allowed.join(', ')}`,
  },
  exemptions: [],
  sourceLine,
  recognizer: 'lint-boundaries',
});

/**
 * `{ from: 'application', allow: ['domain'] }` — an element may only reach the listed elements.
 * With `default: 'disallow'`, an element that has NO rule is the strictest rule of all — it may
 * depend on nothing — and dropping it once made "domain depends on nothing" invisible to the
 * constraint checker while every weaker rule was indexed.
 */
const readElementTypeRules = (content: string): readonly ExtractedConstraint[] => {
  const patterns = readElementPatterns(content);
  const rules = [
    ...content.matchAll(/\{\s*from:\s*['"]([\w-]+)['"]\s*,\s*allow:\s*\[([^\]]*)\]\s*\}/g),
  ];
  const covered = new Set<string>();
  const constraints = rules.map((match) => {
    const from = match[1] ?? '';
    covered.add(from);
    const allowed = [...(match[2] ?? '').matchAll(/['"]([\w-]+)['"]/g)].map(
      (entry) => entry[1] ?? '',
    );
    return boundaryRule(from, allowed, patterns, content.slice(0, match.index).split('\n').length);
  });
  if (rules.length > 0 && /['"]?default['"]?\s*:\s*['"]disallow['"]/.test(content)) {
    for (const role of patterns.keys()) {
      if (!covered.has(role)) {
        constraints.push(boundaryRule(role, [], patterns, 1));
      }
    }
  }
  return constraints;
};

/**
 * A `no-restricted-imports` zone attached to a `files:` glob. The glob is the scope and the
 * restricted specifier is the forbidden dependency — "no `vscode` outside the extension shell"
 * expressed exactly as the repository already expresses it.
 */
const readRestrictedImports = (content: string): readonly ExtractedConstraint[] => {
  const results: ExtractedConstraint[] = [];
  const blocks = [
    ...content.matchAll(
      /files:\s*\[([^\]]*)\][\s\S]{0,600}?'no-restricted-imports':\s*\[[^\]]*?(paths|patterns):\s*([\s\S]{0,400}?)\}\s*\]/g,
    ),
  ];
  for (const block of blocks) {
    const globs = [...(block[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map(
      (entry) => entry[1] ?? '',
    );
    const specifiers = [...(block[3] ?? '').matchAll(/name:\s*['"]([^'"]+)['"]/g)].map(
      (entry) => entry[1] ?? '',
    );
    if (globs.length === 0 || specifiers.length === 0) {
      continue;
    }
    results.push({
      name: `${globs[0] ?? ''} must not import ${specifiers.join(', ')}`,
      kind: 'forbidden-dependency',
      severity: 'blocking',
      extraction: 'recognized',
      scope: { pathGlobs: globs },
      rule: {
        relation: 'FORBIDS',
        subjectPattern: specifiers.join('|'),
        statement: `files matching ${globs.join(', ')} must not import ${specifiers.join(', ')}`,
      },
      exemptions: [],
      sourceLine: content.slice(0, block.index).split('\n').length,
      recognizer: 'lint-boundaries',
    });
  }
  return results;
};

export const lintBoundariesRecognizer: ConstraintRecognizer = {
  id: 'lint-boundaries',
  appliesTo: (path) => CONFIG_PATH.test(path),
  recognize: (file: GuardFile) => [
    ...readElementTypeRules(file.content),
    ...readRestrictedImports(file.content),
  ],
};
