import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { EdgeId, NodeId } from '../ids.js';
import type { GraphEdge } from './graph-edge.js';
import type { GraphNode } from './graph-node.js';

/**
 * The repository knowledge graph (PRD §12, §C14): validated nodes and edges with sorted
 * adjacency indexes for deterministic traversal (PRD §34).
 */
export interface KnowledgeGraph {
  readonly nodes: ReadonlyMap<NodeId, GraphNode>;
  readonly edges: ReadonlyMap<EdgeId, GraphEdge>;
  readonly outgoing: ReadonlyMap<NodeId, readonly EdgeId[]>;
  readonly incoming: ReadonlyMap<NodeId, readonly EdgeId[]>;
}

const referenceIssues = (
  edges: readonly GraphEdge[],
  nodeIds: ReadonlySet<string>,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const edge of edges) {
    for (const end of ['sourceId', 'targetId'] as const) {
      if (!nodeIds.has(edge[end])) {
        issues.push(
          validationIssue(
            'unknown-node-reference',
            `edges[${edge.id}].${end}`,
            `edge '${edge.id}' references nonexistent node '${edge[end]}'`,
          ),
        );
      }
    }
  }
  return issues;
};

const duplicateIssues = (ids: readonly string[], path: 'nodes' | 'edges'): ValidationIssue[] => {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(
        validationIssue(
          'duplicate-id',
          `${path}[${id}]`,
          `duplicate ${path.slice(0, -1)} id '${id}'`,
        ),
      );
    }
    seen.add(id);
  }
  return issues;
};

const push = (index: Map<NodeId, EdgeId[]>, key: NodeId, edgeId: EdgeId): void => {
  const list = index.get(key);
  if (list === undefined) {
    index.set(key, [edgeId]);
  } else {
    list.push(edgeId);
  }
};

/**
 * Assemble without validation — for graphs already known consistent (e.g. induced subgraphs).
 * Package-internal; external construction goes through createKnowledgeGraph.
 */
export const buildKnowledgeGraph = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): KnowledgeGraph => {
  const outgoing = new Map<NodeId, EdgeId[]>();
  const incoming = new Map<NodeId, EdgeId[]>();
  for (const edge of edges) {
    push(outgoing, edge.sourceId, edge.id);
    push(incoming, edge.targetId, edge.id);
  }
  for (const list of [...outgoing.values(), ...incoming.values()]) {
    list.sort();
  }
  return Object.freeze({
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
    outgoing,
    incoming,
  });
};

export const createKnowledgeGraph = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Result<KnowledgeGraph, ValidationError> => {
  const nodeIds = new Set<string>(nodes.map((node) => node.id));
  const issues = [
    ...duplicateIssues(
      nodes.map((node) => node.id),
      'nodes',
    ),
    ...duplicateIssues(
      edges.map((edge) => edge.id),
      'edges',
    ),
    ...referenceIssues(edges, nodeIds),
  ];
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(buildKnowledgeGraph(nodes, edges));
};
