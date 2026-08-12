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

/** `{ from: 'application', allow: ['domain'] }` — an element may only reach the listed elements. */
const readElementTypeRules = (content: string, path: string): readonly ExtractedConstraint[] => {
  const rules = [
    ...content.matchAll(
      /\{\s*from:\s*['"]([\w-]+)['"]\s*,\s*allow:\s*\[([^\]]*)\]\s*\}/g,
    ),
  ];
  return rules.map((match) => {
    const from = match[1] ?? '';
    const allowed = [...(match[2] ?? '').matchAll(/['"]([\w-]+)['"]/g)].map(
      (entry) => entry[1] ?? '',
    );
    return {
      name: `${from} may only depend on ${allowed.join(', ')}`,
      kind: 'boundary-restriction' as const,
      severity: 'blocking' as const,
      extraction: 'recognized' as const,
      scope: { pathGlobs: ['**'], roles: [from] },
      rule: {
        relation: 'ONLY_ALLOWED_TO' as const,
        targetScope: { pathGlobs: [], roles: allowed },
        statement: `code in the '${from}' layer may only depend on ${allowed.length === 0 ? 'nothing' : allowed.join(', ')}`,
      },
      exemptions: [],
      sourceLine: content.slice(0, match.index).split('\n').length,
      recognizer: 'lint-boundaries',
    } satisfies ExtractedConstraint;
  });
};

/**
 * A `no-restricted-imports` zone attached to a `files:` glob. The glob is the scope and the
 * restricted specifier is the forbidden dependency — "no `vscode` outside the extension shell"
 * expressed exactly as the repository already expresses it.
 */
const readRestrictedImports = (content: string, path: string): readonly ExtractedConstraint[] => {
  const results: ExtractedConstraint[] = [];
  const blocks = [
    ...content.matchAll(
      /files:\s*\[([^\]]*)\][\s\S]{0,600}?'no-restricted-imports':\s*\[[^\]]*?(paths|patterns):\s*([\s\S]{0,400}?)\}\s*\]/g,
    ),
  ];
  for (const block of blocks) {
    const globs = [...(block[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1] ?? '');
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
    ...readElementTypeRules(file.content, file.path),
    ...readRestrictedImports(file.content, file.path),
  ],
};
