import type { RequirementSignalInput } from '@impactgraph/application';
import type { ImpactAnalysis, KnowledgeGraph } from '@impactgraph/domain';

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

/**
 * Language that describes bringing something into existence rather than changing something.
 *
 * The first version of this list held only `add`/`create`/`new`/`introduce`, and a self-run showed
 * why that is too narrow: "Index repository rules as first-class entities" and "Model runtime
 * topology" both create surface, and both fell through to `NO_EVIDENCE` — the honest fallback, but
 * the wrong answer. A specification writes creation as whatever verb suits the noun.
 *
 * Widening this is safe only because it is one signal among several and only ever consulted for a
 * requirement that matched NOTHING. A requirement that modifies existing surface has impacts, so it
 * is never classified at all.
 */
const CREATION =
  /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|support for|index|model|models|modelled|emit|emits|expose|exposes|record|records|classify|classifies|derive|derives|represent|represents|extract|extracts|validate|validates)\b/i;
/** Language that names a system this repository does not contain. */
const EXTERNAL =
  /\b(third[- ]party|external (?:service|system|api)|vendor|upstream provider|sendgrid|stripe|twilio)\b/i;

/** Node types that indicate a KIND of surface is indexed at all — the NEW_SURFACE evidence. */
const SURFACE_KINDS: readonly { readonly pattern: RegExp; readonly types: readonly string[] }[] = [
  {
    pattern: /\b(localization|localisation|i18n|translation|locale)\b/i,
    types: ['locale-bundle', 'translation-key'],
  },
  { pattern: /\b(route|endpoint|path)\b/i, types: ['api-endpoint', 'controller', 'handler'] },
  { pattern: /\b(schema|contract)\b/i, types: ['json-schema', 'openapi-document', 'schema'] },
  { pattern: /\b(migration)\b/i, types: ['migration'] },
  { pattern: /\b(feature flag)\b/i, types: ['feature-flag'] },
  { pattern: /\b(event|topic|queue)\b/i, types: ['topic', 'pubsub-topic', 'domain-event'] },
];

export const indexedTypes = (graph: KnowledgeGraph): ReadonlySet<string> => {
  const types = new Set<string>();
  for (const node of graph.nodes.values()) {
    types.add(node.type);
  }
  return types;
};

const siblingSurfaceIndexed = (statement: string, types: ReadonlySet<string>): boolean =>
  SURFACE_KINDS.some(
    (kind) => kind.pattern.test(statement) && kind.types.some((type) => types.has(type)),
  );

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
  if (unresolved.length === 0 || CREATION.test(statement)) {
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
  usesCreationLanguage: CREATION.test(statement),
  referencesExternalBoundary: EXTERNAL.test(statement),
  hasAmbiguousConcept: context.analysis.warnings.some(
    (warning) => warning.code === 'ambiguous-concept' && warning.requirementId === requirementId,
  ),
  siblingSurfaceIndexed: siblingSurfaceIndexed(statement, context.indexedNodeTypes),
});
