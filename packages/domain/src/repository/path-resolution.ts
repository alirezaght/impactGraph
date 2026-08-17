// Scope-aware path resolution ("required must mean strong"). A specification frequently writes
// paths relative to the package or service it discusses ("src/build-impact-model/x.ts" written
// from inside packages/application), while the graph indexes workspace-relative paths. A UNIQUE
// path-boundary suffix match is the same claim as a verbatim path; a suffix matching several
// places is a question for the user, never an anchor; and no match at all stays unresolved.
//
// Pure and dependency-free on purpose: the impact engine (concept matching) and the
// workspace-engine (supplied-identifier resolution) must reach the same verdict about the same
// written path, so they share this one resolver.

/** Anything carrying an optional workspace-relative path — graph nodes qualify structurally. */
export interface PathBearing {
  readonly path?: string | undefined;
}

/** How the reference attached to the indexed path. */
export type PathResolutionVia = 'verbatim' | 'suffix';

export interface ResolvedPathReference<T extends PathBearing> {
  readonly kind: 'resolved';
  readonly via: PathResolutionVia;
  /** The matched path exactly as indexed. */
  readonly path: string;
  /** Every node indexed at that one path (a file and the symbols it declares, for instance). */
  readonly nodes: readonly T[];
}

export interface AmbiguousPathReference {
  readonly kind: 'ambiguous';
  /** The distinct indexed paths the reference could mean, sorted. */
  readonly candidatePaths: readonly string[];
}

export interface UnresolvedPathReference {
  readonly kind: 'unresolved';
}

export type PathReferenceResolution<T extends PathBearing> =
  ResolvedPathReference<T> | AmbiguousPathReference | UnresolvedPathReference;

/** Leading `./` segments are a writer's habit, not part of the identifier. */
export const normalizePathReference = (reference: string): string =>
  reference.trim().replace(/^(?:\.\/)+/, '');

const UNRESOLVED: UnresolvedPathReference = { kind: 'unresolved' };

/** Case-insensitive: resolution serves paths quoted in prose, not filesystem lookups. */
const foldCase = (value: string): string => value.toLowerCase();

interface Buckets<T extends PathBearing> {
  /** Folded path → nodes at that path, kept per distinct indexed path. */
  readonly byFoldedPath: Map<string, { path: string; nodes: T[] }>;
}

const collect = <T extends PathBearing>(
  nodes: Iterable<T>,
  keep: (foldedPath: string) => boolean,
): Buckets<T> => {
  const byFoldedPath = new Map<string, { path: string; nodes: T[] }>();
  for (const node of nodes) {
    if (node.path === undefined) {
      continue;
    }
    const folded = foldCase(node.path);
    if (!keep(folded)) {
      continue;
    }
    const bucket = byFoldedPath.get(folded) ?? { path: node.path, nodes: [] };
    bucket.nodes.push(node);
    byFoldedPath.set(folded, bucket);
  }
  return { byFoldedPath };
};

const verdict = <T extends PathBearing>(
  buckets: Buckets<T>,
  via: PathResolutionVia,
): PathReferenceResolution<T> | undefined => {
  const places = [...buckets.byFoldedPath.values()];
  if (places.length === 1 && places[0] !== undefined) {
    return { kind: 'resolved', via, path: places[0].path, nodes: places[0].nodes };
  }
  if (places.length > 1) {
    return { kind: 'ambiguous', candidatePaths: places.map((place) => place.path).sort() };
  }
  return undefined;
};

/**
 * Resolve a spec-written path reference against the indexed node set.
 *
 * Verbatim workspace-relative equality wins outright; otherwise a path-boundary suffix
 * (`node.path === ref` or `node.path.endsWith('/' + ref)`) is tried. Exactly one distinct indexed
 * path → resolved (with how); several → ambiguous with the candidate list; none → unresolved.
 */
export const resolvePathReference = <T extends PathBearing>(
  reference: string,
  nodes: Iterable<T>,
): PathReferenceResolution<T> => {
  const target = foldCase(normalizePathReference(reference));
  if (target.length === 0) {
    return UNRESOLVED;
  }
  const materialized = [...nodes];
  const verbatim = verdict(
    collect(materialized, (folded) => folded === target),
    'verbatim',
  );
  if (verbatim !== undefined) {
    return verbatim;
  }
  const suffix = `/${target}`;
  return (
    verdict(
      collect(materialized, (folded) => folded.endsWith(suffix)),
      'suffix',
    ) ?? UNRESOLVED
  );
};
