import { listAnalyses, loadAnalysis } from '../analyses.js';
import { failWith } from '../failure.js';
import { loadCurrentGraph, loadGraphAt, withIndexStore } from '../graphs.js';
import { loadSpecification } from '../specifications.js';

import { buildImpactView } from './graph-impact-view.js';
import { groupingForGraph } from './graph-view-source.js';

import type { Failable } from '../failure.js';
import type { ComponentFacts } from './graph-impact-cells.js';
import type { HopEdgeIndex } from './graph-impact-edges.js';
import type { GraphGrouping, GraphView } from './graph-view-model.js';
import type { IndexStorePort } from '@impactgraph/application';
import type { ImpactAnalysis, KnowledgeGraph } from '@impactgraph/domain';

// Loads the IMPACT read model from a stored analysis artifact. Read-only throughout: it reads the
// analysis and specification artifacts, opens the disposable SQLite index to resolve component
// names against the snapshot the analysis was BOUND to, and closes it. No re-analysis, no writes,
// no network — and no engine query functions are added: assembly lives here, in reports/.

const MAX_LISTED_IDS = 12;

/** A wrong id is a configuration error that NAMES the ids that would have worked. */
const notFound = async (rootDir: string, analysisId: string): Promise<Failable<never>> => {
  const listed = await listAnalyses(rootDir);
  if (!listed.ok || listed.value.length === 0) {
    return failWith(
      'configurationError',
      `analysis not found: '${analysisId}' — no stored analyses in this workspace; run \`impactgraph analyze <spec>\` first`,
    );
  }
  const ids = listed.value.slice(0, MAX_LISTED_IDS).map((entry) => entry.id);
  const more =
    listed.value.length > ids.length
      ? ` (and ${String(listed.value.length - ids.length)} more)`
      : '';
  return failWith(
    'configurationError',
    `analysis not found: '${analysisId}' — available: ${ids.join(', ')}${more}`,
  );
};

const componentFactsOf = (graph: KnowledgeGraph): ReadonlyMap<string, ComponentFacts> => {
  const facts = new Map<string, ComponentFacts>();
  for (const node of graph.nodes.values()) {
    facts.set(node.id, {
      name: node.name,
      type: node.type,
      category: node.category,
      ...(node.path === undefined ? {} : { path: node.path }),
      provenance: node.knowledge.provenance,
    });
  }
  return facts;
};

/**
 * The graph edge behind each dependency-path hop, looked up in BOTH directions: a traversal walks
 * `symbol → file` over an edge the graph stores as `file CONTAINS symbol`. Resolving it means an
 * arrow can say `CONTAINS ×12` instead of an unfalsifiable "depends on"; an unresolvable hop is
 * reported as `unknown` rather than assumed deterministic (§43.6).
 */
const hopEdgesOf = (graph: KnowledgeGraph): HopEdgeIndex => {
  const index = new Map<string, { type: string; provenance: string }>();
  for (const edge of graph.edges.values()) {
    const facts = { type: edge.type, provenance: edge.knowledge.provenance };
    index.set(`${edge.sourceId} ${edge.targetId}`, facts);
    const reverse = `${edge.targetId} ${edge.sourceId}`;
    if (!index.has(reverse)) {
      index.set(reverse, facts);
    }
  }
  return index;
};

interface ResolvedGraph {
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
}

/**
 * Resolve names against the snapshot the analysis was BOUND to — that is the world it describes.
 * When the index no longer holds that snapshot, fall back to the current one; the view records both
 * ids so the document can say the two differ instead of implying the analysis is current.
 */
const resolveGraph = async (
  store: IndexStorePort,
  analysis: ImpactAnalysis,
): Promise<Failable<ResolvedGraph>> => {
  const bound = await loadGraphAt(store, analysis.repositorySnapshotId, 'analysis');
  if (bound.ok) {
    return { ok: true, value: { graph: bound.value, snapshotId: analysis.repositorySnapshotId } };
  }
  const current = await loadCurrentGraph(store);
  if (!current.ok) {
    return current;
  }
  return { ok: true, value: { graph: current.value.graph, snapshotId: current.value.snapshotId } };
};

export interface ImpactViewRequest {
  readonly rootDir: string;
  readonly analysisId: string;
  readonly grouping: GraphGrouping;
  /** ADR-0022: `decision` is the default for an analysis; `full` restores the every-surface view. */
  readonly scope?: 'full' | 'decision';
}

export const loadImpactView = async (request: ImpactViewRequest): Promise<Failable<GraphView>> => {
  const analysis = await loadAnalysis(request.rootDir, request.analysisId);
  if (!analysis.ok) {
    return notFound(request.rootDir, request.analysisId);
  }
  // The specification version the analysis SAW, plus the latest, so staleness is derived not guessed.
  const specification = await loadSpecification(
    request.rootDir,
    analysis.value.specificationId,
    analysis.value.specificationVersion,
  );
  if (!specification.ok) {
    return specification;
  }
  const latest = await loadSpecification(request.rootDir, analysis.value.specificationId);
  return withIndexStore(request.rootDir, async (store) => {
    const resolved = await resolveGraph(store, analysis.value);
    if (!resolved.ok) {
      return resolved;
    }
    return {
      ok: true,
      value: buildImpactView({
        grouping: request.grouping,
        analysis: analysis.value,
        specification: specification.value,
        currentSpecificationVersion: latest.ok
          ? latest.value.version
          : analysis.value.specificationVersion,
        resolvedSnapshotId: resolved.value.snapshotId,
        components: componentFactsOf(resolved.value.graph),
        groupOf: groupingForGraph(request.rootDir, resolved.value.graph, request.grouping),
        hopEdges: hopEdgesOf(resolved.value.graph),
        scope: request.scope ?? 'decision',
      }),
    };
  });
};
