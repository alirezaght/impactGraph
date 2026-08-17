import { suppliedIdentifiers } from '@impactgraph/application';
import { resolvePathReference } from '@impactgraph/domain';

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
  /**
   * The unresolved subset whose CONTAINING DIRECTORY is itself indexed (ADR-0022).
   *
   * These are the only ones a wrong-assumption reading survives: the author pointed at a real
   * place in this repository and named something that is not there. An unresolved path whose
   * whole scope is unknown — `templates/admin/digest_preview.html` in a repository with no
   * `templates/admin` — is new surface, another system, or an illustrative example, and calling
   * it an invalid assumption was the tool inventing a risk out of a for-instance.
   */
  readonly unresolvedInKnownScope: readonly string[];
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

/**
 * A token resolves when the shared scope-aware path resolver finds it — verbatim, or by a
 * path-boundary suffix, including the AMBIGUOUS case: several places sharing the suffix is a
 * question for clarification, never evidence that the specification asserts a missing file — or
 * when it matches a node NAME (identifiers like route names carry no path).
 */
const resolvesInGraph = (graph: KnowledgeGraph, token: string): boolean => {
  if (resolvePathReference(token, graph.nodes.values()).kind !== 'unresolved') {
    return true;
  }
  for (const node of graph.nodes.values()) {
    const name = node.name.toLowerCase();
    if (name === token || name.endsWith(`/${token}`)) {
      return true;
    }
  }
  return false;
};

/** Every directory that contains an indexed file, as a lowercase set of path prefixes. */
const indexedDirectories = (graph: KnowledgeGraph): ReadonlySet<string> => {
  const directories = new Set<string>();
  for (const node of graph.nodes.values()) {
    const path = node.path?.toLowerCase();
    if (path === undefined) {
      continue;
    }
    let cut = path.lastIndexOf('/');
    while (cut > 0) {
      const directory = path.slice(0, cut);
      if (directories.has(directory)) {
        break;
      }
      directories.add(directory);
      cut = directory.lastIndexOf('/');
    }
  }
  return directories;
};

/**
 * True when the token's parent directory is indexed — verbatim or as the tail of an indexed
 * directory, so a service-relative `src/domain/alert` is recognised inside its package.
 */
const scopeIsKnown = (token: string, directories: ReadonlySet<string>): boolean => {
  const cut = token.lastIndexOf('/');
  if (cut <= 0) {
    return false; // a bare filename carries no scope to check
  }
  const parent = token.slice(0, cut);
  if (directories.has(parent)) {
    return true;
  }
  for (const directory of directories) {
    if (directory.endsWith(`/${parent}`)) {
      return true;
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
  const directories = indexedDirectories(graph);
  return {
    pathShapedCount: pathShaped.length,
    resolvedCount: pathShaped.length - unresolved.length,
    unresolved,
    unresolvedInKnownScope: unresolved.filter((token) => scopeIsKnown(token, directories)),
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
