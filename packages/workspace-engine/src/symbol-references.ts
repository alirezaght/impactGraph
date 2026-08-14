import { REFERENCE_KINDS } from '@impactgraph/contracts';

import { candidatesFor, scoreNode, tokensOf } from './component-search-scoring.js';
import { EMPTY_FRAGMENT_FACTS, loadFragmentFacts } from './fragment-facts.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { Failable } from './failure.js';
import type { FragmentFacts } from './fragment-facts.js';
import type { IndexStorePort } from '@impactgraph/application';
import type { GraphNode, KnowledgeGraph, NodeId } from '@impactgraph/domain';

// find_references — "who calls / implements / extends / imports / injects this?" answered from
// the deterministic index. Two channels, kept visibly apart (§3): structural edges (assembly
// resolved the target) and name-matched call sites from the fragment cache (only the NAME is
// known to match — every site carries `basis: 'name-match'` and the coverage says so).

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

interface KindSpec {
  readonly edgeType: string;
  readonly direction: 'incoming' | 'outgoing';
}

/** callers = incoming CALLS, implementations = incoming IMPLEMENTS, … (PRD §12.2). */
const KIND_SPECS: Readonly<Record<ReferenceKind, KindSpec>> = {
  callers: { edgeType: 'CALLS', direction: 'incoming' },
  callees: { edgeType: 'CALLS', direction: 'outgoing' },
  implementations: { edgeType: 'IMPLEMENTS', direction: 'incoming' },
  extensions: { edgeType: 'EXTENDS', direction: 'incoming' },
  importers: { edgeType: 'IMPORTS', direction: 'incoming' },
  imports: { edgeType: 'IMPORTS', direction: 'outgoing' },
  injections: { edgeType: 'INJECTS', direction: 'outgoing' },
};

export interface ReferencedNode {
  readonly nodeId: string;
  readonly name: string;
  readonly type: string;
  readonly path?: string | undefined;
}

export interface ReferenceCounterpart extends ReferencedNode {
  readonly provenance: string;
}

export interface ReferenceGroup {
  readonly kind: ReferenceKind;
  readonly edgeType: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly counterparts: readonly ReferenceCounterpart[];
  readonly totalCount: number;
}

export interface NameMatchedCallSite {
  readonly basis: 'name-match';
  readonly filePath: string;
  readonly calleeName: string;
  readonly receiver?: string | undefined;
  readonly line?: number | undefined;
  readonly sampleArgument?: string | undefined;
  readonly sampleArgumentTruncated?: boolean | undefined;
}

export interface ReferenceCoverage {
  readonly snapshotId: string;
  readonly searched: readonly string[];
  readonly knownLimits: readonly string[];
  readonly filesSearched: number;
  readonly filesWithoutCachedFacts: number;
}

export interface FindReferencesResult {
  readonly query: string;
  readonly resolution: 'resolved' | 'ambiguous' | 'not-found';
  readonly resolved?: ReferencedNode | undefined;
  readonly candidates?: readonly ReferencedNode[] | undefined;
  readonly references: readonly ReferenceGroup[];
  readonly nameMatchedCallSites: readonly NameMatchedCallSite[];
  readonly nameMatchedCallSiteTotal: number;
  readonly coverage: ReferenceCoverage;
}

export interface FindReferencesRequest {
  readonly query: string;
  readonly kinds?: readonly ReferenceKind[] | undefined;
  readonly limit?: number | undefined;
}

const DEFAULT_LIMIT = 50;
const MAX_CANDIDATES = 10;

/** What this query can and cannot see — stated on every result, not only the empty ones. */
export const REFERENCE_KNOWN_LIMITS: readonly string[] = [
  "Member calls (receiver.method(...)) are matched by callee NAME only — the receiver's type is never resolved, so a name-matched call site proves a call with this name occurs there, not that it targets this exact symbol.",
  'The TypeScript adapter records member calls inside function bodies only when at least one argument is a string literal; member calls without string arguments are absent from the fragment cache and cannot be matched.',
  'Non-exported module-scope arrow functions are not indexed as symbols, so they can appear neither as callers nor as callees.',
  'A call that also resolved into a structural CALLS edge can appear in both channels; the structural edge is the resolved fact, the call site is the name match.',
  'This is not a full-text search of file contents — only the knowledge graph and the cached call/decorator facts were searched.',
];

const referencedNodeOf = (node: GraphNode): ReferencedNode => ({
  nodeId: node.id,
  name: node.name,
  type: node.type,
  ...(node.path === undefined ? {} : { path: node.path }),
});

/**
 * Resolve a query to nodes: a direct nodeId hit wins; otherwise the component-search scorer's
 * `exact` grade, falling back to `normalized-name`, falling back to member-suffix matches —
 * methods and fields are indexed as `Owner.member`, and "who calls remove_item" arrives as the
 * bare member name. Several survivors are returned as-is — the caller reports them as
 * disambiguation candidates instead of guessing (PRD §34).
 */
interface ResolutionQuery {
  readonly graph: KnowledgeGraph;
  readonly query: string;
  readonly tokens: readonly string[];
  readonly suffix: string;
}

const gradeOf = (
  node: GraphNode,
  context: ResolutionQuery,
): 'exact' | 'normalized' | 'member-suffix' | undefined => {
  const scored = scoreNode(node, context.query, context.tokens, context.graph);
  if (scored?.matchKind === 'exact') {
    return 'exact';
  }
  if (scored?.matchKind === 'normalized-name') {
    return 'normalized';
  }
  return IDENTIFIER.test(context.query) && node.name.endsWith(context.suffix)
    ? 'member-suffix'
    : undefined;
};

const resolveQuery = (graph: KnowledgeGraph, query: string): readonly GraphNode[] => {
  const direct = graph.nodes.get(query as NodeId);
  if (direct !== undefined) {
    return [direct];
  }
  const context = { graph, query, tokens: tokensOf(query), suffix: `.${query}` };
  const byGrade = { exact: [], normalized: [], 'member-suffix': [] } as Record<string, GraphNode[]>;
  for (const node of candidatesFor(graph, undefined)) {
    const grade = gradeOf(node, context);
    if (grade !== undefined) {
      byGrade[grade]?.push(node);
    }
  }
  const matches = [byGrade['exact'], byGrade['normalized'], byGrade['member-suffix']].find(
    (nodes) => nodes !== undefined && nodes.length > 0,
  );
  return [...(matches ?? [])].sort((a, b) => a.id.localeCompare(b.id));
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `ItemStore.remove_item` → `remove_item`; `deal-service.ts` stays whole (not identifiers). */
const shortNameOf = (name: string): string => {
  const segments = name.split('.');
  const last = segments.at(-1);
  return segments.length > 1 && last !== undefined && segments.every((s) => IDENTIFIER.test(s))
    ? last
    : name.trim();
};

const groupFor = (
  graph: KnowledgeGraph,
  node: GraphNode,
  kind: ReferenceKind,
  limit: number,
): ReferenceGroup => {
  const spec = KIND_SPECS[kind];
  const edgeIds =
    spec.direction === 'incoming'
      ? (graph.incoming.get(node.id) ?? [])
      : (graph.outgoing.get(node.id) ?? []);
  const counterparts: ReferenceCounterpart[] = [];
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || edge.type !== spec.edgeType) {
      continue;
    }
    const other = graph.nodes.get(spec.direction === 'incoming' ? edge.sourceId : edge.targetId);
    if (other === undefined) {
      continue;
    }
    counterparts.push({ ...referencedNodeOf(other), provenance: edge.knowledge.provenance });
  }
  counterparts.sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId));
  return {
    kind,
    edgeType: spec.edgeType,
    direction: spec.direction,
    counterparts: counterparts.slice(0, limit),
    totalCount: counterparts.length,
  };
};

const SAMPLE_ARGUMENT_LENGTH = 120;

const sampleArgumentOf = (
  argument: string | undefined,
): Pick<NameMatchedCallSite, 'sampleArgument' | 'sampleArgumentTruncated'> => {
  if (argument === undefined) {
    return {};
  }
  return {
    sampleArgument: argument.slice(0, SAMPLE_ARGUMENT_LENGTH),
    ...(argument.length > SAMPLE_ARGUMENT_LENGTH ? { sampleArgumentTruncated: true } : {}),
  };
};

const siteForCallFact = (
  facts: FragmentFacts,
  fact: FragmentFacts['callFacts'][number],
): NameMatchedCallSite => {
  const line = facts.lineByEvidenceId.get(fact.evidenceId);
  return {
    basis: 'name-match',
    filePath: fact.filePath,
    calleeName: fact.calleeName,
    ...(fact.receiverName === undefined ? {} : { receiver: fact.receiverName }),
    ...(line === undefined ? {} : { line }),
    ...sampleArgumentOf(fact.stringArguments.find((value) => value.length > 0)),
  };
};

/** Cached call facts and unresolved call references whose callee name equals `shortName`. */
const callSitesFor = (facts: FragmentFacts, shortName: string): NameMatchedCallSite[] => {
  const sites: NameMatchedCallSite[] = [];
  for (const fact of facts.callFacts) {
    if (fact.calleeName === shortName) {
      sites.push(siteForCallFact(facts, fact));
    }
  }
  for (const reference of facts.symbolReferences) {
    if (reference.kind !== 'calls' || reference.targetName !== shortName) {
      continue;
    }
    const line = facts.lineByEvidenceId.get(reference.evidenceId);
    sites.push({
      basis: 'name-match',
      filePath: reference.filePath,
      calleeName: reference.targetName,
      ...(line === undefined ? {} : { line }),
    });
  }
  sites.sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.calleeName.localeCompare(b.calleeName),
  );
  return sites;
};

export const findReferencesInStore = async (
  store: IndexStorePort,
  request: FindReferencesRequest,
): Promise<Failable<FindReferencesResult>> => {
  const current = await loadCurrentGraph(store);
  if (!current.ok) {
    return current;
  }
  const { graph, snapshotId } = current.value;
  const limit = request.limit ?? DEFAULT_LIMIT;
  const kinds = REFERENCE_KINDS.filter(
    (kind) => request.kinds === undefined || request.kinds.includes(kind),
  );
  // AI-independent and cache-tolerant (§34): an unreadable fact cache degrades the call-site
  // channel with an explicit statement; it never hides the structural answer.
  const factsLoaded = await loadFragmentFacts(store, snapshotId);
  const facts = factsLoaded.ok ? factsLoaded.value : EMPTY_FRAGMENT_FACTS;
  const coverage: ReferenceCoverage = {
    snapshotId,
    searched: [
      `structural CALLS/IMPLEMENTS/EXTENDS/IMPORTS/INJECTS edges of the knowledge graph at snapshot ${snapshotId} (${String(graph.nodes.size)} nodes, ${String(graph.edges.size)} edges)`,
      factsLoaded.ok
        ? `name-matched call sites from cached call/decorator facts of ${String(facts.filesSearched - facts.filesWithoutCachedFacts)} of ${String(facts.filesSearched)} indexed files`
        : `cached call/decorator facts were NOT searched (${factsLoaded.error.message})`,
    ],
    knownLimits: REFERENCE_KNOWN_LIMITS,
    filesSearched: facts.filesSearched,
    filesWithoutCachedFacts: facts.filesWithoutCachedFacts,
  };
  const matches = resolveQuery(graph, request.query);
  const [first] = matches;
  if (first === undefined || matches.length > 1) {
    // Not resolvable to one node — call sites still answer by NAME, which is all they ever claim.
    const sites = callSitesFor(facts, shortNameOf(request.query));
    return {
      ok: true,
      value: {
        query: request.query,
        resolution: first === undefined ? 'not-found' : 'ambiguous',
        ...(first === undefined
          ? {}
          : { candidates: matches.slice(0, MAX_CANDIDATES).map(referencedNodeOf) }),
        references: [],
        nameMatchedCallSites: sites.slice(0, limit),
        nameMatchedCallSiteTotal: sites.length,
        coverage,
      },
    };
  }
  const sites = callSitesFor(facts, shortNameOf(first.name));
  return {
    ok: true,
    value: {
      query: request.query,
      resolution: 'resolved',
      resolved: referencedNodeOf(first),
      references: kinds.map((kind) => groupFor(graph, first, kind, limit)),
      nameMatchedCallSites: sites.slice(0, limit),
      nameMatchedCallSiteTotal: sites.length,
      coverage,
    },
  };
};

export const findReferences = (
  rootDir: string,
  request: FindReferencesRequest,
): Promise<Failable<FindReferencesResult>> =>
  withIndexStore(rootDir, (store) => findReferencesInStore(store, request));
