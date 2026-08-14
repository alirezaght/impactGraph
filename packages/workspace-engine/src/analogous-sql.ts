import { sqlComparisonPatterns } from '@impactgraph/application';

import { loadFragmentFacts } from './fragment-facts.js';
import { withIndexStore } from './graphs.js';
import { collectLiteralMatches } from './literal-search.js';

import type { AnalogousLiteralMatch } from '@impactgraph/application';

// ADR-0020 §4 — the "how is this SQL handled elsewhere?" half of a type-sensitive-comparison
// finding. The application layer detects the comparison operators a specification's SQL uses;
// this module (which owns store access) searches the persisted call/decorator string literals
// for the same operators and hands the locations back IN. Purely advisory enrichment: any
// failure here degrades a recommendation's pointer, never the preflight pass itself.

/** Locations per operator — enough to point a reader somewhere real, not enough to bury them. */
const MAX_MATCHES_PER_PATTERN = 3;

export const analogousSqlLiterals = async (
  rootDir: string,
  snapshotId: string,
  specificationText: string,
): Promise<readonly AnalogousLiteralMatch[]> => {
  const patterns = sqlComparisonPatterns(specificationText);
  if (patterns.length === 0) {
    return []; // no SQL comparisons in the plan — skip the store entirely
  }
  const facts = await withIndexStore(rootDir, (store) => loadFragmentFacts(store, snapshotId));
  if (!facts.ok) {
    return []; // degraded, never fatal — the finding still stands without the pointer
  }
  return patterns.flatMap((pattern) =>
    collectLiteralMatches(facts.value, (literal) => literal.includes(pattern))
      .slice(0, MAX_MATCHES_PER_PATTERN)
      .map((match) => ({
        pattern,
        filePath: match.filePath,
        ...(match.line === undefined ? {} : { line: match.line }),
      })),
  );
};
