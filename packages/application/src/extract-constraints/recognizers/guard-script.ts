import {
  allowCollections,
  failsTheBuild,
  readCollectionLiterals,
  readGuardPatterns,
  readScopedDirectories,
} from '../guard-literals.js';
import { looksLikeGuardPath } from '../types.js';

import type { ConstraintRecognizer, ExtractedConstraint, GuardFile } from '../types.js';
import type { ConstraintKind, ConstraintRelation } from '@impactgraph/domain';

/**
 * The general shape: a script that walks part of the repository, matches a forbidden pattern, and
 * fails the build unless the offending location is allowlisted.
 *
 * `ci/scripts/check-service-peer-http.py` is one instance of this shape, not a special case. The
 * recognizer knows the shape; the repository supplies the instance. That is the whole point — the
 * extractor must generalise to the next guard nobody has written yet.
 */

/** Classify what the guard forbids from the pattern it matches on. */
const classifyPattern = (
  pattern: string,
): { kind: ConstraintKind; relation: ConstraintRelation } | undefined => {
  // Matched against a REGEX SOURCE, not against code: `https?://` contains a literal `?`, so the
  // tests below must recognise the pattern language rather than the URLs it would match.
  if (/http|requests\.|httpx|fetch\(|axios|urlopen|HttpClient|grpc/i.test(pattern)) {
    return { kind: 'forbidden-runtime-call', relation: 'FORBIDS' };
  }
  if (/import|\bfrom\b|require|#include/i.test(pattern)) {
    return { kind: 'forbidden-dependency', relation: 'RESTRICTS_DEPENDENCY' };
  }
  return undefined;
};

const scopeGlobs = (content: string): readonly string[] => {
  const directories = readScopedDirectories(content);
  return directories.length === 0 ? ['**'] : directories.map((entry) => `${entry}/**`);
};

/**
 * Why severity is `blocking` only when the script can fail the build: a guard that prints and
 * returns zero is advice, and reporting advice as a blocker would stop work on something CI itself
 * lets through.
 */
const severityFor = (content: string): 'blocking' | 'warning' =>
  failsTheBuild(content) ? 'blocking' : 'warning';

const describe = (kind: ConstraintKind, pattern: string, scope: readonly string[]): string =>
  kind === 'forbidden-runtime-call'
    ? `code under ${scope.join(', ')} must not make calls matching ${pattern}`
    : `code under ${scope.join(', ')} must not depend on modules matching ${pattern}`;

const opaqueConstraint = (file: GuardFile): ExtractedConstraint => ({
  name: file.path.split('/').pop() ?? file.path,
  kind: 'opaque-check',
  severity: 'warning',
  extraction: 'opaque',
  scope: { pathGlobs: scopeGlobs(file.content) },
  rule: {
    relation: 'MUST_PASS',
    statement: `${file.path} guards this repository, and its rule was not extracted`,
  },
  exemptions: [],
  notExtractedReason:
    'the guard does not match a known shape — no literal forbidden pattern paired with a readable allowlist was found',
  recognizer: 'guard-script',
});

const recognizeOne = (file: GuardFile): readonly ExtractedConstraint[] => {
  const patterns = readGuardPatterns(file.content);
  const collections = readCollectionLiterals(file.content);
  const exemptions = allowCollections(collections).flatMap((collection) =>
    collection.values.map((value) => ({
      id: `${collection.name}:${value}`,
      subject: value,
      reason: `allowlisted in ${collection.name}`,
    })),
  );
  const scope = scopeGlobs(file.content);
  const constraints: ExtractedConstraint[] = [];
  for (const pattern of patterns) {
    const classified = classifyPattern(pattern.source);
    if (classified === undefined) {
      continue;
    }
    constraints.push({
      name: `${file.path.split('/').pop() ?? file.path}: ${classified.kind}`,
      kind: classified.kind,
      severity: severityFor(file.content),
      extraction: 'recognized',
      scope: { pathGlobs: scope },
      rule: {
        relation: classified.relation,
        subjectPattern: pattern.source,
        statement: describe(classified.kind, pattern.source, scope),
      },
      exemptions,
      sourceLine: pattern.line,
      recognizer: 'guard-script',
    });
  }
  // A guard that exists but was not understood is still a finding. Reporting nothing here is how
  // the peer-HTTP rule stayed invisible until CI failed.
  return constraints.length > 0 ? constraints : [opaqueConstraint(file)];
};

export const guardScriptRecognizer: ConstraintRecognizer = {
  id: 'guard-script',
  appliesTo: (path) => looksLikeGuardPath(path) && /\.(py|sh|ts|js|mjs)$/.test(path),
  recognize: recognizeOne,
};
