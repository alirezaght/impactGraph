import { resolvePathReference } from '@impactgraph/domain';

import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// "Required must mean strong" — the anchor-grade rules for written paths and bare filenames.
//
// A specification writes paths relative to the package or service it discusses, so a
// '/'-containing concept is resolved through the shared domain resolver: verbatim wins, a UNIQUE
// path-boundary suffix is the same claim as a verbatim path (identifier-grade), and a suffix
// matching several places is a question for the user — never an anchor. A bare filename
// (extension, no '/') is one step weaker still: `specification.ts` in two packages is two
// coincidences, and even a unique basename match stays a name-level guess.

const byId = (a: GraphNode, b: GraphNode): number => a.id.localeCompare(b.id);

export type WrittenPathOutcome =
  | {
      readonly kind: 'resolved';
      readonly mechanism: 'exact' | 'path-suffix';
      readonly nodes: readonly GraphNode[];
    }
  | { readonly kind: 'ambiguous'; readonly candidatePaths: readonly string[] }
  | { readonly kind: 'unresolved' };

/** Resolve a '/'-containing concept the specification wrote against the indexed paths. */
export const resolveWrittenPath = (graph: KnowledgeGraph, concept: string): WrittenPathOutcome => {
  const resolution = resolvePathReference(concept, graph.nodes.values());
  if (resolution.kind === 'resolved') {
    return {
      kind: 'resolved',
      // A verbatim workspace-relative path keeps today's exact grade; a unique suffix records
      // that it was a SCOPED resolution while staying identifier-grade for classification.
      mechanism: resolution.via === 'verbatim' ? 'exact' : 'path-suffix',
      nodes: [...resolution.nodes].sort(byId),
    };
  }
  return resolution.kind === 'ambiguous'
    ? { kind: 'ambiguous', candidatePaths: resolution.candidatePaths }
    : { kind: 'unresolved' };
};

const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/** A filename with an extension but no directory — not identifier-grade on its own. */
export const isBareFilename = (concept: string): boolean =>
  !concept.includes('/') && EXTENSION.test(concept);

export type BareFilenameOutcome =
  | { readonly kind: 'ambiguous' }
  /** The concept IS a root file's full path — identifier-grade, keep exact. */
  | { readonly kind: 'exact'; readonly nodes: readonly GraphNode[] }
  /** A unique basename match — kept, but demoted to the capped `basename` mechanism. */
  | { readonly kind: 'basename'; readonly nodes: readonly GraphNode[] }
  /** Not a bare filename; the caller's mechanism stands. */
  | undefined;

/**
 * Grade an exact match that was reached by a bare filename. Two or more distinct places sharing
 * the basename make the concept ambiguous — no required anchor on a guess between files.
 */
export const assessBareFilename = (
  concept: string,
  nodes: readonly GraphNode[],
): BareFilenameOutcome => {
  if (!isBareFilename(concept)) {
    return undefined;
  }
  const target = concept.toLowerCase();
  const verbatim = nodes.filter((node) => node.path?.toLowerCase() === target);
  if (verbatim.length > 0) {
    return { kind: 'exact', nodes: verbatim };
  }
  const places = new Set(nodes.map((node) => node.path?.toLowerCase() ?? node.id));
  if (places.size >= 2) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'basename', nodes };
};
