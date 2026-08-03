import { traverseCandidates } from '../build-impact-model/candidate-traversal.js';
import { matchConcepts } from '../build-impact-model/concept-matching.js';

import type { KnowledgeGraph, NodeId, OpenQuestionSeverity } from '@impactgraph/domain';

// Story 15.1/15.2 — deterministic halves of §C4: per-interpretation impact footprints,
// divergence, the materiality threshold (§C3), and cost-based severity (§C5/§C6).

/** The impact footprint of one interpretation: concept matches + bounded traversal. */
export const interpretationFootprint = (
  graph: KnowledgeGraph,
  concepts: readonly string[],
  aliases: Readonly<Record<string, string>>,
): ReadonlySet<string> => {
  const matched = matchConcepts(graph, concepts, aliases);
  const traversal = traverseCandidates(graph, matched.matches, { maxDepth: 2 });
  return new Set(traversal.candidates.map((candidate) => candidate.nodeId));
};

export interface FootprintDivergence {
  /** Node ids present in exactly one of the two footprints. */
  readonly divergentNodeIds: readonly string[];
  readonly severity: OpenQuestionSeverity | undefined;
}

/**
 * §C6 severity from what the divergent nodes ARE:
 * data/migration or event/messaging divergence → blocking (data ownership, migrations,
 * event ownership); infrastructure or ≥2 diverging components → important; a single
 * diverging component → minor. No divergence → no question (§C3: convergent readings
 * are the same implementation).
 */
const severityOf = (
  graph: KnowledgeGraph,
  divergentNodeIds: readonly string[],
): OpenQuestionSeverity | undefined => {
  if (divergentNodeIds.length === 0) {
    return undefined;
  }
  const categories = new Set(
    divergentNodeIds.map((id) => graph.nodes.get(id as NodeId)?.category ?? 'unknown'),
  );
  if (categories.has('data') || categories.has('integration')) {
    return 'blocking';
  }
  if (categories.has('infrastructure') || divergentNodeIds.length >= 2) {
    return 'important';
  }
  return 'minor';
};

export const compareFootprints = (
  graph: KnowledgeGraph,
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): FootprintDivergence => {
  const divergent = [
    ...[...a].filter((id) => !b.has(id)),
    ...[...b].filter((id) => !a.has(id)),
  ].sort();
  return { divergentNodeIds: divergent, severity: severityOf(graph, divergent) };
};

export const nodeNames = (graph: KnowledgeGraph, ids: readonly string[]): string[] =>
  ids.map((id) => graph.nodes.get(id as NodeId)?.name ?? id);
