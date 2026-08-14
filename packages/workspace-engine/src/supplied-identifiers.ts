import { suppliedIdentifiers } from '@impactgraph/application';

import type { CliImpactSummary } from '@impactgraph/contracts';
import type { KnowledgeGraph } from '@impactgraph/domain';

/**
 * Resolve the specification's PATH-SHAPED identifiers against the indexed graph (ADR-0017 §5).
 *
 * Only identifiers a writer must have KNOWN as files are checked — something containing a '/' or
 * carrying a file extension. Prose words and bare symbols are excluded deliberately: "the export
 * button" failing to resolve is noise, "modify services/x.py" failing to resolve is either new
 * surface or a wrong assumption, and the per-requirement classifier decides which.
 */

export interface SuppliedIdentifierResolution {
  /** Distinct path-shaped identifiers the specification stated. */
  readonly pathShapedCount: number;
  /** How many of them resolve to an indexed component. */
  readonly resolvedCount: number;
  /** The full unresolved list (lowercased, sorted). Cap at the wire, not here — the
   *  invalid-assumption signal needs every miss, the report only the first few. */
  readonly unresolved: readonly string[];
}

/** How many unresolved identifiers the summary block lists. */
export const UNRESOLVED_IDENTIFIER_LIMIT = 10;

const EXTENSION = /\.[a-z][a-z0-9]{0,4}$/;

const isPathShaped = (token: string): boolean => token.includes('/') || EXTENSION.test(token);

/**
 * `suppliedIdentifiers` adds the basename of every path it finds ("services/x.py" also yields
 * "x.py"). For resolution the derived basename is a duplicate of the same claim, so only maximal
 * tokens are kept — "x.py" survives alone only when the specification wrote it alone.
 */
const maximalTokens = (tokens: readonly string[]): readonly string[] =>
  tokens.filter((token) => !tokens.some((other) => other !== token && other.endsWith(`/${token}`)));

const resolvesInGraph = (graph: KnowledgeGraph, token: string): boolean => {
  for (const node of graph.nodes.values()) {
    for (const candidate of [node.path, node.name]) {
      if (candidate === undefined) {
        continue;
      }
      const lower = candidate.toLowerCase();
      if (lower === token || lower.endsWith(`/${token}`)) {
        return true;
      }
    }
  }
  return false;
};

export const resolveSuppliedIdentifiers = (
  specificationText: string,
  graph: KnowledgeGraph,
): SuppliedIdentifierResolution => {
  const pathShaped = maximalTokens(
    [...suppliedIdentifiers(specificationText)].filter(isPathShaped),
  );
  const unresolved = pathShaped.filter((token) => !resolvesInGraph(graph, token)).sort();
  return {
    pathShapedCount: pathShaped.length,
    resolvedCount: pathShaped.length - unresolved.length,
    unresolved,
  };
};

/** The bounded wire block for the analyze summary. */
export const toSuppliedIdentifiersDto = (
  resolution: SuppliedIdentifierResolution,
): NonNullable<CliImpactSummary['suppliedIdentifiers']> => ({
  pathShapedCount: resolution.pathShapedCount,
  resolvedCount: resolution.resolvedCount,
  unresolved: [...resolution.unresolved.slice(0, UNRESOLVED_IDENTIFIER_LIMIT)],
});
