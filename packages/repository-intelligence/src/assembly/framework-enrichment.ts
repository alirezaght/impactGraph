import type { AssembledGraph } from './assemble.js';
import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CodeGraph, FrameworkAdapter } from '@impactgraph/framework-adapters';
import type { IndexingContext, ParseWarning } from '@impactgraph/language-adapters';

// Story 3.1 — the detection pipeline (PRD §31): adapters run AFTER language indexing and only
// add fragments. Language facts always win on id collisions; framework edges referencing
// nonexistent nodes are dropped with a warning, never persisted (CLAUDE.md rule 4).

const firstWins = <T extends { id: string }>(
  existing: Map<string, T>,
  additions: readonly T[],
): void => {
  for (const record of additions) {
    if (!existing.has(record.id)) {
      existing.set(record.id, record);
    }
  }
};

interface EdgeMergeInput {
  readonly adapterId: string;
  readonly fragmentEdges: readonly GraphEdge[];
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: Map<string, GraphEdge>;
  readonly warnings: ParseWarning[];
}

const mergeValidEdges = ({
  adapterId,
  fragmentEdges,
  nodes,
  edges,
  warnings,
}: EdgeMergeInput): void => {
  for (const edge of fragmentEdges) {
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
      warnings.push({
        filePath: adapterId,
        adapterId,
        message: `framework edge '${edge.id}' references a nonexistent node — dropped`,
      });
      continue;
    }
    if (!edges.has(edge.id)) {
      edges.set(edge.id, edge);
    }
  }
};

export const enrichWithFrameworks = async (
  assembled: AssembledGraph,
  adapters: readonly FrameworkAdapter[],
  context: IndexingContext,
  disabledFrameworks: readonly string[] = [],
): Promise<AssembledGraph> => {
  const nodes = new Map(assembled.nodes.map((node) => [node.id, node]));
  const edges = new Map(assembled.edges.map((edge) => [edge.id, edge]));
  const evidence = new Map(assembled.evidence.map((record) => [record.id, record]));
  const warnings: ParseWarning[] = [...assembled.warnings];

  /**
   * The graph as enriched SO FAR — rebuilt per adapter, not captured once.
   *
   * Cross-stack detection (PRD §C13) has no other way to work: `route:<VERB> <path>` and topic
   * nodes are themselves produced by framework adapters, so an adapter that correlates them must
   * see its predecessors' output. Language facts still win every id collision (`firstWins`), and
   * ordering is an explicit composition decision — the cross-stack adapter is registered last in
   * `packages/workspace-engine/src/indexing.ts`, and the fixture goldens mirror that order.
   */
  const viewOf = (): CodeGraph => ({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    decorators: assembled.decorators,
    callFacts: assembled.callFacts,
    symbolReferences: assembled.symbolReferences,
    resolveSymbol: assembled.resolveSymbol,
    importsOf: assembled.importsOf,
  });

  for (const adapter of adapters) {
    if (disabledFrameworks.includes(adapter.id)) {
      continue;
    }
    const codeGraph = viewOf();
    const detection = await adapter.detect(codeGraph);
    if (!detection.detected) {
      continue;
    }
    const fragment = await adapter.enrich(codeGraph, { indexing: context, detection });
    firstWins(nodes, fragment.nodes);
    firstWins(evidence, fragment.evidence);
    warnings.push(...fragment.warnings);
    mergeValidEdges({
      adapterId: adapter.id,
      fragmentEdges: fragment.edges,
      nodes,
      edges,
      warnings,
    });
  }

  return {
    ...assembled,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    evidence: [...evidence.values()],
    warnings,
  };
};
