import { createPreflightFinding } from '@impactgraph/domain';

import type { PreflightFinding } from '@impactgraph/domain';

/**
 * A design that leans on an engine-specific SQL mechanism, held against the database the tests
 * actually run.
 *
 * The failure shape: the plan says `ON CONFLICT DO NOTHING`, production runs Postgres, and the
 * test suite runs SQLite or H2 — so the one behaviour the plan depends on is exactly the one the
 * tests never exercise. Both facts are stated in the repository; this analyzer puts them side by
 * side and does nothing else. No test environment declared means silence, not suspicion.
 */

export type DatabaseEngine = 'postgres' | 'mysql' | 'sqlite' | 'h2';

/** A test-scoped database declaration, read from a test config file by the caller. */
export interface TestEnvironmentFact {
  readonly engine: DatabaseEngine;
  readonly filePath: string;
  readonly evidenceIds: readonly string[];
}

/** Constructs that only one engine family executes as written. Deliberately short and strong. */
const DIALECT_MARKERS: readonly { readonly engine: DatabaseEngine; readonly pattern: RegExp }[] = [
  { engine: 'postgres', pattern: /\bON CONFLICT\b/i },
  { engine: 'postgres', pattern: /\bgen_random_uuid\s*\(/i },
  { engine: 'postgres', pattern: /::(uuid|jsonb|text\[\])/i },
  { engine: 'postgres', pattern: /\bILIKE\b/ },
  { engine: 'postgres', pattern: /\bto_tsvector\s*\(/i },
  { engine: 'postgres', pattern: /\bjsonb_/i },
  { engine: 'mysql', pattern: /\bON DUPLICATE KEY UPDATE\b/i },
];

export interface DialectUse {
  readonly engine: DatabaseEngine;
  /** The construct as matched — the quotable evidence. */
  readonly construct: string;
}

export const detectSqlDialect = (text: string): DialectUse | undefined => {
  for (const marker of DIALECT_MARKERS) {
    const match = marker.pattern.exec(text);
    if (match !== null) {
      return { engine: marker.engine, construct: match[0] };
    }
  }
  return undefined;
};

export interface CheckTestEnvironmentInput {
  readonly specificationText: string;
  readonly testEnvironments: readonly TestEnvironmentFact[];
  readonly requirementIds: readonly string[];
  readonly nextId: (seed: string) => string;
}

export const checkTestEnvironment = (
  input: CheckTestEnvironmentInput,
): readonly PreflightFinding[] => {
  if (input.testEnvironments.length === 0) {
    return [];
  }
  const dialect = detectSqlDialect(input.specificationText);
  if (dialect === undefined) {
    return [];
  }
  if (input.testEnvironments.some((environment) => environment.engine === dialect.engine)) {
    return [];
  }
  const declared = input.testEnvironments[0] as TestEnvironmentFact;
  const engines = [...new Set(input.testEnvironments.map((environment) => environment.engine))];
  const result = createPreflightFinding({
    id: input.nextId(`test-env:${dialect.construct}`),
    kind: 'constraint-warning',
    severity: 'warning',
    verification: 'unverified-assumption',
    requirementIds: [...input.requirementIds],
    statement: `The specification uses ${dialect.engine}-specific SQL ('${dialect.construct}'), but the repository's test environment declares ${engines.join(' and ')} (${declared.filePath}) — the tests will not exercise this SQL as written.`,
    recommendation: `Run the affected tests against ${dialect.engine}, or use a construct both engines execute, or record explicitly that this path is tested elsewhere.`,
    subject: { filePaths: [declared.filePath] },
    evidenceIds: [...declared.evidenceIds],
    confidence: 0.7,
    provenance: 'configuration',
    analyzer: 'check-test-environment',
  });
  return result.ok ? [result.value] : [];
};
