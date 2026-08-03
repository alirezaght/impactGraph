import { knowledgeCategoryOf } from '@impactgraph/domain';

import { failWith } from './failure.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { componentOf, overlayFor, relationshipOf } from './overlay.js';
import { evidenceFilesFor, evidenceRangesFor } from './specifications.js';

import type { Failable } from './failure.js';
import type { EffectiveComponent, EffectiveRelationship } from './overlay.js';
import type { EdgeId, GraphEdge, GraphNode, KnowledgeGraph, NodeId } from '@impactgraph/domain';

// Story 12.3 — architecture queries + explanations. Explanations mirror the evidence panel
// (§18.5): provenance and knowledge category are always present, so agents can distinguish
// deterministic facts from inferences (§3) without heuristics.

export interface ComponentHit {
  readonly nodeId: string;
  readonly name: string;
  readonly category: string;
  readonly type: string;
  readonly path?: string | undefined;
  readonly provenance: string;
}

export interface KnowledgeExplanation {
  readonly provenance: string;
  /** deterministic | ai-inferred | human-confirmed — derived, never stored (§3). */
  readonly knowledgeCategory: string;
  readonly confidence: number;
  readonly confidenceSignals: readonly { type: string; contribution: number }[];
  readonly evidence: readonly {
    id: string;
    source: string;
    /** §40.4: declaration range, when the evidence is a file range. */
    range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  }[];
  readonly repositorySnapshotId: string;
  readonly analysisRunId: string;
}

export interface NodeExplanation {
  readonly nodeId: string;
  readonly name: string;
  readonly category: string;
  readonly type: string;
  readonly path?: string | undefined;
  readonly knowledge: KnowledgeExplanation;
  readonly incomingEdges: readonly {
    edgeId: string;
    type: string;
    from: string;
    fromName: string;
  }[];
  readonly outgoingEdges: readonly { edgeId: string; type: string; to: string; toName: string }[];
  /** §16/§Z5 read-time overlay — the corrections that apply, and which level produced each. */
  readonly effective: EffectiveComponent;
}

export interface EdgeExplanation {
  readonly edgeId: string;
  readonly type: string;
  readonly source: { nodeId: string; name: string };
  readonly target: { nodeId: string; name: string };
  readonly knowledge: KnowledgeExplanation;
  /** §16 confirm/reject overlay — a rejected edge is reported excluded, never dropped. */
  readonly effective: EffectiveRelationship;
}

const hitFor = (node: GraphNode): ComponentHit => ({
  nodeId: node.id,
  name: node.name,
  category: node.category,
  type: node.type,
  path: node.path,
  provenance: node.knowledge.provenance,
});

export const findComponents = async (
  rootDir: string,
  query: string,
  limit = 25,
): Promise<Failable<ComponentHit[]>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const needle = query.toLowerCase();
    const hits: ComponentHit[] = [];
    for (const node of current.value.graph.nodes.values()) {
      if (
        node.name.toLowerCase().includes(needle) ||
        (node.path?.toLowerCase().includes(needle) ?? false)
      ) {
        hits.push(hitFor(node));
        if (hits.length >= limit) {
          break;
        }
      }
    }
    return { ok: true, value: hits };
  });

const explainKnowledge = async (
  store: Parameters<typeof evidenceFilesFor>[0],
  knowledge: GraphNode['knowledge'],
): Promise<KnowledgeExplanation> => {
  const files = await evidenceFilesFor(store, knowledge.evidenceIds);
  const ranges = await evidenceRangesFor(store, knowledge.evidenceIds);
  return {
    provenance: knowledge.provenance,
    knowledgeCategory: knowledgeCategoryOf(knowledge.provenance),
    confidence: knowledge.confidence.value,
    confidenceSignals: knowledge.confidence.signals.map((signal) => ({
      type: signal.type,
      contribution: signal.contribution,
    })),
    evidence: knowledge.evidenceIds.map((id) => {
      const range = ranges.get(id);
      return {
        id,
        source: files.get(id) ?? 'unresolved',
        ...(range === undefined ? {} : { range }),
      };
    }),
    repositorySnapshotId: knowledge.repositorySnapshotId,
    analysisRunId: knowledge.analysisRunId,
  };
};

const edgesTouching = (
  graph: KnowledgeGraph,
  nodeId: string,
): { incoming: GraphEdge[]; outgoing: GraphEdge[] } => {
  const incoming: GraphEdge[] = [];
  const outgoing: GraphEdge[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.sourceId === nodeId) {
      outgoing.push(edge);
    }
    if (edge.targetId === nodeId) {
      incoming.push(edge);
    }
  }
  return { incoming, outgoing };
};

export const explainNode = async (
  rootDir: string,
  nodeId: string,
): Promise<Failable<NodeExplanation>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    const node = graph.nodes.get(nodeId as NodeId);
    if (node === undefined) {
      return failWith('configurationError', `node not found in the current graph: ${nodeId}`);
    }
    const { incoming, outgoing } = edgesTouching(graph, nodeId);
    const nameOf = (id: string): string => graph.nodes.get(id as NodeId)?.name ?? id;
    const overlay = overlayFor(rootDir, graph);
    return {
      ok: true,
      value: {
        nodeId: node.id,
        name: node.name,
        category: node.category,
        type: node.type,
        path: node.path,
        effective: componentOf(overlay, node.id),
        knowledge: await explainKnowledge(store, node.knowledge),
        incomingEdges: incoming.map((edge) => ({
          edgeId: edge.id,
          type: edge.type,
          from: edge.sourceId,
          fromName: nameOf(edge.sourceId),
        })),
        outgoingEdges: outgoing.map((edge) => ({
          edgeId: edge.id,
          type: edge.type,
          to: edge.targetId,
          toName: nameOf(edge.targetId),
        })),
      },
    };
  });

export const explainEdge = async (
  rootDir: string,
  edgeId: string,
): Promise<Failable<EdgeExplanation>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    const edge = graph.edges.get(edgeId as EdgeId);
    if (edge === undefined) {
      return failWith('configurationError', `edge not found in the current graph: ${edgeId}`);
    }
    const nameOf = (id: string): string => graph.nodes.get(id as NodeId)?.name ?? id;
    const overlay = overlayFor(rootDir, graph);
    return {
      ok: true,
      value: {
        edgeId: edge.id,
        type: edge.type,
        source: { nodeId: edge.sourceId, name: nameOf(edge.sourceId) },
        target: { nodeId: edge.targetId, name: nameOf(edge.targetId) },
        knowledge: await explainKnowledge(store, edge.knowledge),
        effective: relationshipOf(overlay, edge.id),
      },
    };
  });
