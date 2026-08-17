import type { EdgeId, NodeId } from '../ids.js';
import type { GraphNode } from './graph-node.js';
import type { KnowledgeGraph } from './knowledge-graph.js';

/**
 * Inheritance-aware member resolution.
 *
 * `SqlOutboundQueueRepository.list_rows` was declared nonexistent while `list_rows` sat on a mixin
 * the class extends: membership was judged against one node's outgoing DECLARES_MEMBER/CONTAINS
 * edges, and EXTENDS/IMPLEMENTS were never followed. This module is the structural fix: a member
 * lookup walks the container's resolved supertype closure before anything may claim absence.
 *
 * Absence itself is split in two, because the graph knows two different things. When every
 * reachable supertype is indexed, "not found" is a closed-world fact. When the container (or any
 * reachable supertype) inherits from a type outside the index — modelled as an
 * `unresolved-external-boundary` node — the member set is OPEN and "not found" means only
 * "could not verify". Collapsing the two is how a fabricated BLOCKED verdict happens.
 */

/** The node type assembly emits for a supertype it could not resolve inside the index. */
const OPEN_BOUNDARY_TYPE = 'unresolved-external-boundary';

const HERITAGE_EDGE_TYPES = new Set(['EXTENDS', 'IMPLEMENTS']);
const MEMBERSHIP_EDGE_TYPES = new Set(['DECLARES_MEMBER', 'CONTAINS']);

/** Cycles are guarded by the visited set; the bound only caps degenerate chains. */
const DEFAULT_MAX_DEPTH = 16;

export interface MemberResolutionOptions {
  /** Node types that count as members (`method`, `field`, `enum-member`, …) — caller-supplied. */
  readonly memberTypes: ReadonlySet<string>;
  readonly maxDepth?: number;
}

export type MemberResolution =
  | {
      readonly outcome: 'found';
      readonly member: GraphNode;
      /** The type node that declares the member — the container itself or a supertype. */
      readonly provider: GraphNode;
      readonly inherited: boolean;
    }
  | {
      readonly outcome: 'not-found';
      /** True when the container or a reachable supertype inherits from outside the index. */
      readonly memberSetOpen: boolean;
      /** Indexed supertypes that were actually searched (the container excluded). */
      readonly resolvedSupertypeCount: number;
      /** Bare member names declared across the searched hierarchy, sorted. */
      readonly declaredMemberNames: readonly string[];
      /**
       * Node types of those members, sorted. A consumer needs this to judge openness honestly:
       * an `enum-member` roster is syntactically complete however open the inheritance chain is,
       * while a `method`/`field` roster is exactly what a mixin outside the index can extend.
       */
      readonly declaredMemberTypes: readonly string[];
    };

/**
 * The bare name a provider declares a member under. Field and method nodes are named
 * `Owner.member` (TS marks nullability with a trailing `?`); enum members and translation keys are
 * named bare. Stripping THIS provider's prefix — never the original container's — is what lets
 * `OutboundAuditReadsMixin.list_rows` satisfy a lookup made on the subclass.
 */
const bareMemberName = (provider: GraphNode, member: GraphNode): string => {
  const name = member.name.endsWith('?') ? member.name.slice(0, -1) : member.name;
  const prefix = `${provider.name}.`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
};

const outgoingEdgeIds = (graph: KnowledgeGraph, nodeId: NodeId): readonly EdgeId[] =>
  [...(graph.outgoing.get(nodeId) ?? [])].sort();

/** Members this provider declares, as bare names mapped to their nodes, in stable order. */
const declaredOn = (
  graph: KnowledgeGraph,
  provider: GraphNode,
  memberTypes: ReadonlySet<string>,
): readonly { name: string; member: GraphNode }[] => {
  const declared: { name: string; member: GraphNode }[] = [];
  for (const edgeId of outgoingEdgeIds(graph, provider.id)) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || !MEMBERSHIP_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const target = graph.nodes.get(edge.targetId);
    if (target !== undefined && memberTypes.has(target.type)) {
      declared.push({ name: bareMemberName(provider, target), member: target });
    }
  }
  return declared;
};

/** Supertypes one heritage hop from the node, in stable edge-id order. */
const supertypesOf = (graph: KnowledgeGraph, nodeId: NodeId): readonly GraphNode[] => {
  const supertypes: GraphNode[] = [];
  for (const edgeId of outgoingEdgeIds(graph, nodeId)) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || !HERITAGE_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const target = graph.nodes.get(edge.targetId);
    if (target !== undefined) {
      supertypes.push(target);
    }
  }
  return supertypes;
};

/** One search's fixed inputs plus the knowledge it accumulates while the BFS walks the closure. */
interface Search {
  readonly graph: KnowledgeGraph;
  readonly memberName: string;
  readonly memberTypes: ReadonlySet<string>;
  readonly containerId: NodeId;
  readonly visited: Set<NodeId>;
  readonly declaredNames: Set<string>;
  readonly declaredTypes: Set<string>;
  memberSetOpen: boolean;
  resolvedSupertypeCount: number;
}

/** Search ONE provider: return the found member, or record what it declares and queue its bases. */
const searchProvider = (
  search: Search,
  provider: GraphNode,
  next: GraphNode[],
): MemberResolution | undefined => {
  if (provider.type === OPEN_BOUNDARY_TYPE) {
    search.memberSetOpen = true; // nothing to search behind a boundary the index cannot see past
    return undefined;
  }
  if (provider.id !== search.containerId) {
    search.resolvedSupertypeCount += 1;
  }
  for (const declared of declaredOn(search.graph, provider, search.memberTypes)) {
    if (declared.name === search.memberName) {
      return {
        outcome: 'found',
        member: declared.member,
        provider,
        inherited: provider.id !== search.containerId,
      };
    }
    search.declaredNames.add(declared.name);
    search.declaredTypes.add(declared.member.type);
  }
  for (const supertype of supertypesOf(search.graph, provider.id)) {
    if (!search.visited.has(supertype.id)) {
      search.visited.add(supertype.id);
      next.push(supertype);
    }
  }
  return undefined;
};

/**
 * Resolve a bare member name against a container and its supertype closure: BFS over outgoing
 * EXTENDS/IMPLEMENTS edges, cycle-guarded and depth-bounded, checking DECLARES_MEMBER/CONTAINS
 * targets at every visited type. Pure and deterministic — same graph, same answer.
 */
export const resolveMember = (
  graph: KnowledgeGraph,
  container: GraphNode,
  memberName: string,
  options: MemberResolutionOptions,
): MemberResolution => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const search: Search = {
    graph,
    memberName,
    memberTypes: options.memberTypes,
    containerId: container.id,
    visited: new Set([container.id]),
    declaredNames: new Set(),
    declaredTypes: new Set(),
    memberSetOpen: false,
    resolvedSupertypeCount: 0,
  };
  let frontier: readonly GraphNode[] = [container];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: GraphNode[] = [];
    for (const provider of frontier) {
      const found = searchProvider(search, provider, next);
      if (found !== undefined) {
        return found;
      }
    }
    frontier = next;
  }
  // A chain cut off by the depth bound leaves supertypes unsearched — that is an open set too.
  return {
    outcome: 'not-found',
    memberSetOpen: search.memberSetOpen || frontier.length > 0,
    resolvedSupertypeCount: search.resolvedSupertypeCount,
    declaredMemberNames: [...search.declaredNames].sort(),
    declaredMemberTypes: [...search.declaredTypes].sort(),
  };
};
