import { PREDICTIVE_LIKELIHOODS } from '@impactgraph/domain';

import type {
  EdgeChangeSummary,
  GraphEdge,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
} from '@impactgraph/domain';

/**
 * Deterministic classification of the review's architectural edge changes (item 7, PRD §C15.3).
 *
 * Input is the set `compareImplementation` already computed — added/removed edges touching a
 * changed file — and the review-time graphs, context-augmented by the caller when bounded
 * contexts are configured (`BELONGS_TO_CONTEXT` edges from the read-time overlay). Repository
 * attribution is injected as a function so this module never learns about workspace rosters.
 *
 * Exactly one category per entry, assigned by precedence — boundary-crossing first, because a
 * cross-boundary edge is the rarer, more decision-relevant fact than the same edge's newness:
 *   1. `cross-context`      — endpoints belong to different configured bounded contexts.
 *   2. `cross-repository`   — endpoints attribute to different registered repositories.
 *   3. `direction-reversal` — the same edge type was removed A→B and added B→A.
 *   4. `new-dependency`     — added edge between two nodes that both existed in the approved
 *      snapshot (a genuinely new coupling between pre-existing components).
 *      `removed-dependency` — removed edge whose endpoints both still exist.
 *   5. `other`              — everything else (e.g. an edge into a brand-new node).
 *
 * Boundary categories are produced only where the boundary is KNOWN (contexts configured,
 * multi-root roster) — never guessed. Drift entries are planning-review signals for a human;
 * they are NOT §24.1 findings and never feed `hasDiscrepancies`.
 */

export const DRIFT_CATEGORIES = [
  'cross-context',
  'cross-repository',
  'direction-reversal',
  'new-dependency',
  'removed-dependency',
  'other',
] as const;

export type DriftCategory = (typeof DRIFT_CATEGORIES)[number];

export interface DriftEndpoint {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly context?: string;
  readonly repository?: string;
}

export interface DriftEntry {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly direction: 'added' | 'removed';
  readonly category: DriftCategory;
  readonly from: DriftEndpoint;
  readonly to: DriftEndpoint;
}

export interface DriftClassification {
  readonly entries: readonly DriftEntry[];
  readonly omitted: readonly { readonly category: DriftCategory; readonly count: number }[];
  /** Absent when no contexts are configured — "not assessable", never an empty guess. */
  readonly unmappedContexts?: {
    readonly contexts: readonly string[];
    readonly omitted?: number;
  };
}

export interface ClassifyDriftRequest {
  readonly analysis: ImpactAnalysis;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
  /** The review's edge changes — already filtered to edges touching a changed file, and capped
   *  upstream with the omission counted on the review itself. */
  readonly edgeChanges: EdgeChangeSummary;
  readonly changedFiles: readonly string[];
  /** Injected repository attribution — provided only under a multi-root roster. */
  readonly owningRepositoryOf?: (path: string | undefined) => string;
}

/** Report cap per drift category; anything beyond it is COUNTED, never silently dropped. */
export const DRIFT_ENTRY_LIMIT = 25;

const MEMBERSHIP_EDGE = 'BELONGS_TO_CONTEXT';

interface ContextIndex {
  readonly configured: boolean;
  readonly byNodeId: ReadonlyMap<string, string>;
  readonly byPath: ReadonlyMap<string, string>;
  /** Directory prefixes of package-level members, longest first. */
  readonly prefixes: readonly { readonly prefix: string; readonly context: string }[];
}

const contextIndexOf = (graph: KnowledgeGraph): ContextIndex => {
  const byNodeId = new Map<string, string>();
  const byPath = new Map<string, string>();
  const prefixes: { prefix: string; context: string }[] = [];
  let configured = false;
  for (const node of graph.nodes.values()) {
    if (node.type === 'bounded-context') {
      configured = true;
    }
  }
  for (const edge of graph.edges.values()) {
    if (edge.type !== MEMBERSHIP_EDGE) {
      continue;
    }
    const member = graph.nodes.get(edge.sourceId);
    const context = graph.nodes.get(edge.targetId);
    if (member === undefined || context === undefined) {
      continue;
    }
    byNodeId.set(member.id, context.name);
    if (member.path !== undefined) {
      byPath.set(member.path, context.name);
      if (member.type === 'package' && member.path.includes('/')) {
        prefixes.push({
          prefix: member.path.slice(0, member.path.lastIndexOf('/')),
          context: context.name,
        });
      }
    }
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return { configured, byNodeId, byPath, prefixes };
};

const contextOfPath = (index: ContextIndex, path: string): string | undefined =>
  index.byPath.get(path) ??
  index.prefixes.find((entry) => path.startsWith(`${entry.prefix}/`))?.context;

const contextOfNode = (index: ContextIndex, node: GraphNode): string | undefined =>
  index.byNodeId.get(node.id) ??
  (node.path === undefined ? undefined : contextOfPath(index, node.path));

const reversalKey = (edge: GraphEdge): string => `${edge.targetId}→${edge.sourceId}:${edge.type}`;
const edgeKey = (edge: GraphEdge): string => `${edge.sourceId}→${edge.targetId}:${edge.type}`;

interface ResolvedChange {
  readonly edge: GraphEdge;
  readonly direction: 'added' | 'removed';
  readonly from: GraphNode;
  readonly to: GraphNode;
}

const resolveChanges = (
  ids: readonly string[],
  direction: 'added' | 'removed',
  graph: KnowledgeGraph,
): ResolvedChange[] => {
  const resolved: ResolvedChange[] = [];
  for (const id of ids) {
    const edge = graph.edges.get(id as never);
    if (edge === undefined || edge.type === MEMBERSHIP_EDGE) {
      continue; // unresolvable ids and overlay membership edges are never drift entries
    }
    const from = graph.nodes.get(edge.sourceId);
    const to = graph.nodes.get(edge.targetId);
    if (from !== undefined && to !== undefined) {
      resolved.push({ edge, direction, from, to });
    }
  }
  return resolved;
};

interface ClassifierState {
  readonly request: ClassifyDriftRequest;
  readonly contextIndexes: { readonly added: ContextIndex; readonly removed: ContextIndex };
  readonly reverseKeys: {
    readonly added: ReadonlySet<string>;
    readonly removed: ReadonlySet<string>;
  };
}

/** Boundary categories — produced only where the boundary is KNOWN. */
const boundaryCategory = (
  change: ResolvedChange,
  state: ClassifierState,
): DriftCategory | undefined => {
  const index = state.contextIndexes[change.direction];
  const fromContext = contextOfNode(index, change.from);
  const toContext = contextOfNode(index, change.to);
  if (fromContext !== undefined && toContext !== undefined && fromContext !== toContext) {
    return 'cross-context';
  }
  const attribute = state.request.owningRepositoryOf;
  if (attribute !== undefined && attribute(change.from.path) !== attribute(change.to.path)) {
    return 'cross-repository';
  }
  return undefined;
};

const structuralCategory = (change: ResolvedChange, state: ClassifierState): DriftCategory => {
  const opposite =
    change.direction === 'added' ? state.reverseKeys.removed : state.reverseKeys.added;
  if (opposite.has(reversalKey(change.edge))) {
    return 'direction-reversal';
  }
  const otherGraph =
    change.direction === 'added' ? state.request.approvedGraph : state.request.currentGraph;
  if (otherGraph.nodes.has(change.from.id) && otherGraph.nodes.has(change.to.id)) {
    return change.direction === 'added' ? 'new-dependency' : 'removed-dependency';
  }
  return 'other';
};

const categorize = (change: ResolvedChange, state: ClassifierState): DriftCategory =>
  boundaryCategory(change, state) ?? structuralCategory(change, state);

const endpoint = (
  node: GraphNode,
  index: ContextIndex,
  attribute: ClassifyDriftRequest['owningRepositoryOf'],
): DriftEndpoint => {
  const context = contextOfNode(index, node);
  const repository = attribute?.(node.path);
  return {
    nodeId: node.id,
    nodeName: node.name,
    ...(context === undefined ? {} : { context }),
    ...(repository === undefined ? {} : { repository }),
  };
};

const entryOf = (change: ResolvedChange, state: ClassifierState): DriftEntry => {
  const index = state.contextIndexes[change.direction];
  return {
    edgeId: change.edge.id,
    edgeType: change.edge.type,
    direction: change.direction,
    category: categorize(change, state),
    from: endpoint(change.from, index, state.request.owningRepositoryOf),
    to: endpoint(change.to, index, state.request.owningRepositoryOf),
  };
};

const boundByCategory = (
  entries: readonly DriftEntry[],
): Pick<DriftClassification, 'entries' | 'omitted'> => {
  const kept: DriftEntry[] = [];
  const omitted: { category: DriftCategory; count: number }[] = [];
  for (const category of DRIFT_CATEGORIES) {
    const inCategory = entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    kept.push(...inCategory.slice(0, DRIFT_ENTRY_LIMIT));
    if (inCategory.length > DRIFT_ENTRY_LIMIT) {
      omitted.push({ category, count: inCategory.length - DRIFT_ENTRY_LIMIT });
    }
  }
  return { entries: kept, omitted };
};

/** Contexts of the approved PREDICTIVE impacts — the feature's expected footprint. */
const footprintContexts = (request: ClassifyDriftRequest, index: ContextIndex): Set<string> => {
  const contexts = new Set<string>();
  for (const impact of request.analysis.requirementImpacts) {
    if (!PREDICTIVE_LIKELIHOODS.includes(impact.likelihood)) {
      continue;
    }
    const node =
      request.approvedGraph.nodes.get(impact.nodeId as NodeId) ??
      request.currentGraph.nodes.get(impact.nodeId as NodeId);
    const context = node?.path === undefined ? undefined : contextOfPath(index, node.path);
    if (context !== undefined) {
      contexts.add(context);
    }
  }
  return contexts;
};

const unmappedContextTouches = (
  request: ClassifyDriftRequest,
  index: ContextIndex,
): DriftClassification['unmappedContexts'] => {
  if (!index.configured) {
    return undefined;
  }
  const footprint = footprintContexts(request, index);
  const touched = new Set<string>();
  for (const path of request.changedFiles) {
    const context = contextOfPath(index, path);
    if (context !== undefined && !footprint.has(context)) {
      touched.add(context);
    }
  }
  const contexts = [...touched].sort((a, b) => a.localeCompare(b));
  const omittedCount = Math.max(0, contexts.length - DRIFT_ENTRY_LIMIT);
  return {
    contexts: contexts.slice(0, DRIFT_ENTRY_LIMIT),
    ...(omittedCount > 0 ? { omitted: omittedCount } : {}),
  };
};

export const classifyDrift = (request: ClassifyDriftRequest): DriftClassification => {
  const added = resolveChanges(request.edgeChanges.added, 'added', request.currentGraph);
  const removed = resolveChanges(request.edgeChanges.removed, 'removed', request.approvedGraph);
  const currentIndex = contextIndexOf(request.currentGraph);
  const state: ClassifierState = {
    request,
    contextIndexes: { added: currentIndex, removed: contextIndexOf(request.approvedGraph) },
    reverseKeys: {
      added: new Set(added.map(({ edge }) => edgeKey(edge))),
      removed: new Set(removed.map(({ edge }) => edgeKey(edge))),
    },
  };
  const bounded = boundByCategory([...added, ...removed].map((change) => entryOf(change, state)));
  const unmapped = unmappedContextTouches(request, currentIndex);
  return { ...bounded, ...(unmapped === undefined ? {} : { unmappedContexts: unmapped }) };
};
