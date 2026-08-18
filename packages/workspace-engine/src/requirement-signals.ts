import {
  referencesExternalBoundary,
  siblingSurfaceIndexed,
  usesCreationLanguage,
} from '@impactgraph/application';

import type { RequirementSignalInput } from '@impactgraph/application';
import type { ImpactAnalysis } from '@impactgraph/domain';

// The language recognizers moved to `@impactgraph/application` (ADR-0025) so the unresolved-surface
// classifier reads a requirement with exactly the same vocabulary this classifier does. Re-exported
// here because existing consumers import `indexedTypes` from this module.
export { indexedTypes } from '@impactgraph/application';

/**
 * The deterministic classification signals for one requirement, shared by the preflight pass and
 * the coverage verdict so the two can never disagree about the same requirement.
 *
 * The one signal with history here is `touchesUnindexedRepository`. It used to be read off "this
 * requirement is unmatched", which reinterpreted every unmatched requirement as a repository
 * problem — a live run on a FULLY indexed workspace classified everything as COVERAGE_GAP with a
 * rationale claiming an unindexed repository while `registeredButMissing` was empty in the same
 * response. It is now a roster FACT supplied by the caller: true only when a registered, enabled
 * repository is actually absent from the current index.
 */

export interface RequirementSignalContext {
  readonly analysis: ImpactAnalysis;
  /**
   * Registered, enabled repositories absent from the current index — the SAME roster computation
   * that feeds `workspaceCoverage.repositories`, so a classification rationale can never claim a
   * missing repository the coverage block denies.
   */
  readonly missingRepositoryCount: number;
  readonly indexedNodeTypes: ReadonlySet<string>;
  /**
   * The specification's path-shaped identifiers that resolve to NOTHING indexed (lowercased) —
   * from `resolveSuppliedIdentifiers`, the same computation the analyze summary reports. A
   * requirement that states one of these without creation language is asserting a file that does
   * not exist at the indexed revision.
   */
  /**
   * Unresolved path-shaped identifiers whose containing directory IS indexed (ADR-0022). A path
   * whose whole scope is unknown to the index is new surface, another system, or an example —
   * never evidence that the specification assumes something this repository lacks.
   */
  readonly unresolvedSuppliedIdentifiers: readonly string[];
}

/**
 * "Modify services/x.py" when x.py does not exist IS an invalid assumption; "add file foo/bar.ts"
 * is not — creation language means the file is SUPPOSED to be missing.
 */
const assertsMissingIdentifier = (statement: string, unresolved: readonly string[]): boolean => {
  if (unresolved.length === 0 || usesCreationLanguage(statement)) {
    return false;
  }
  const lower = statement.toLowerCase();
  return unresolved.some((token) => lower.includes(token));
};

export const buildRequirementSignals = (
  statement: string,
  requirementId: string,
  context: RequirementSignalContext,
): RequirementSignalInput => ({
  hasInvalidSymbolAssumption: assertsMissingIdentifier(
    statement,
    context.unresolvedSuppliedIdentifiers,
  ),
  // A roster fact, never an inference from "nothing matched": when no registered repository is
  // missing, an unmatched requirement flows to NEW_SURFACE / NO_EVIDENCE / AMBIGUOUS /
  // EXTERNAL_DEPENDENCY instead of a coverage claim the roster contradicts.
  touchesUnindexedRepository: context.missingRepositoryCount > 0,
  touchesIndexingGap: false,
  usesCreationLanguage: usesCreationLanguage(statement),
  referencesExternalBoundary: referencesExternalBoundary(statement),
  hasAmbiguousConcept: context.analysis.warnings.some(
    (warning) => warning.code === 'ambiguous-concept' && warning.requirementId === requirementId,
  ),
  siblingSurfaceIndexed: siblingSurfaceIndexed(statement, context.indexedNodeTypes),
});
