import { PROPOSED_GROUP, isProposedNode } from './proposed.js';

import type { GraphViewNode, StructureView } from './proposed.js';
import type { ImpactGraphEdgeDto } from '@impactgraph/contracts';

// PRD §18.4 filters and grouping, as pure predicates. Nodes are filtered BEFORE Cytoscape sees
// them — never rendered and then hidden, which would already have paid the layout cost.
// Filters may hide inferred knowledge; they may never restyle it to look deterministic (§3).

export type GroupBy =
  'context' | 'application' | 'requirement' | 'impact-type' | 'likelihood' | 'knowledge';

export interface GraphFilters {
  readonly search: string;
  /** Empty = every impact type. */
  readonly impactTypes: readonly string[];
  readonly likelihoods: readonly string[];
  readonly minConfidence: number;
  /** §18.4 "show inferred relationships only". */
  readonly inferredOnly: boolean;
  readonly directness: 'all' | 'direct' | 'indirect';
  /** §18.4 "hide unchanged architecture": drop dependency-path hops that carry no impact. */
  readonly hideUnchanged: boolean;
  /** §18.4 current-vs-proposed. The two halves are diffed, never merged (§3). */
  readonly structure: StructureView;
  readonly groupBy: GroupBy;
}

/**
 * §18.4: the DEFAULT level is context → component → integration/data dependency. Grouping by
 * context is what makes the compound parents contexts and the leaves components; requirement
 * grouping stays one click away (and the impact TREE opens on requirements, so neither reading
 * of the analysis is lost).
 */
export const DEFAULT_FILTERS: GraphFilters = {
  search: '',
  impactTypes: [],
  likelihoods: [],
  minConfidence: 0,
  inferredOnly: false,
  directness: 'all',
  hideUnchanged: false,
  // Both halves by default: the point of §18.4 is that current and proposed can be compared.
  structure: 'both',
  groupBy: 'context',
};

const matchesSearch = (node: GraphViewNode, search: string): boolean =>
  search.length === 0 ||
  node.name.toLowerCase().includes(search.toLowerCase()) ||
  (node.filePath?.toLowerCase().includes(search.toLowerCase()) ?? false);

const matchesFacets = (node: GraphViewNode, filters: GraphFilters): boolean => {
  if (filters.impactTypes.length > 0 && !filters.impactTypes.includes(node.impactType ?? '')) {
    return false;
  }
  if (filters.likelihoods.length > 0 && !filters.likelihoods.includes(node.likelihood ?? '')) {
    return false;
  }
  if (filters.directness !== 'all' && node.directness !== filters.directness) {
    return false;
  }
  return !(filters.inferredOnly && node.knowledgeCategory !== 'ai-inferred');
};

const keepsDependencyHop = (node: GraphViewNode, filters: GraphFilters): boolean =>
  !filters.hideUnchanged && matchesSearch(node, filters.search);

export const applyNodeFilters = (
  nodes: readonly GraphViewNode[],
  filters: GraphFilters,
): GraphViewNode[] =>
  nodes.filter((node) => {
    if (isProposedNode(node)) {
      // A proposal has no likelihood, impact type or directness, so the impact facets cannot
      // speak about it. Answering "does it match?" with those filters would silently hide the
      // proposed half; only search and the structure view (applied upstream) apply here.
      return matchesSearch(node, filters.search);
    }
    if (node.kind === 'dependency') {
      return keepsDependencyHop(node, filters);
    }
    if ((node.confidence ?? 0) < filters.minConfidence) {
      return false;
    }
    return matchesSearch(node, filters.search) && matchesFacets(node, filters);
  });

/** An edge survives only when both endpoints do — the graph never dangles (§18.4). */
export const applyEdgeFilters = (
  edges: readonly ImpactGraphEdgeDto[],
  visibleNodeIds: ReadonlySet<string>,
): ImpactGraphEdgeDto[] =>
  edges.filter((edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId));

export interface GroupAssignment {
  readonly id: string;
  readonly label: string;
}

/**
 * Compound-parent assignment (§18.4 "group by"). Context grouping uses the effective context
 * resolved through the §Z5 overlay; a component with no assigned context groups under an
 * explicit "no context assigned" bucket rather than being guessed into one from its path.
 */
/** Single-value grouping dimensions, each with its own "absent" label — never a guess. */
const SIMPLE_GROUPS: Readonly<
  Record<
    string,
    { readonly of: (node: GraphViewNode) => string | undefined; readonly absent: string }
  >
> = {
  context: { of: (node) => node.context, absent: 'no context assigned' },
  application: { of: (node) => node.application, absent: 'no application' },
  'impact-type': { of: (node) => node.impactType, absent: 'no impact type' },
  likelihood: { of: (node) => node.likelihood, absent: 'dependency path' },
  knowledge: { of: (node) => node.knowledgeCategory, absent: 'unclassified' },
};

export const groupFor = (
  node: GraphViewNode,
  groupBy: GroupBy,
  requirementLabels: ReadonlyMap<string, string>,
): GroupAssignment => {
  // Proposed components never join a current group, whatever the grouping dimension: putting
  // them in a context bucket beside real components is exactly the merge §3 forbids.
  if (isProposedNode(node)) {
    return PROPOSED_GROUP;
  }
  const simple = SIMPLE_GROUPS[groupBy];
  if (simple !== undefined) {
    const value = simple.of(node) ?? simple.absent;
    return { id: `group:${groupBy}:${value}`, label: value };
  }
  const requirementId = node.requirementIds[0] ?? 'unassigned';
  return {
    id: `group:req:${requirementId}`,
    label: requirementLabels.get(requirementId) ?? requirementId,
  };
};
