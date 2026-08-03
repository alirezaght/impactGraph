import type { KnowledgeGraph } from '@impactgraph/domain';

// Story 6.1 — concept-to-node matching. Every match records which mechanism produced it (the
// match-strength signal for the confidence engine); unknown concepts become warnings, never
// invented nodes.

export type MatchMechanism = 'exact' | 'alias' | 'name-similarity';

export interface ConceptMatch {
  readonly concept: string;
  readonly nodeId: string;
  readonly mechanism: MatchMechanism;
  readonly evidenceIds: readonly string[];
  /** True when this concept matched more than one node — feeds the ambiguity penalty (§14). */
  readonly ambiguous: boolean;
}

export interface ConceptMatchResult {
  readonly matches: readonly ConceptMatch[];
  readonly unknownConcepts: readonly string[];
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_MATCHES_PER_CONCEPT = 5;

const findByName = (
  graph: KnowledgeGraph,
  name: string,
): { exact: string[]; similar: string[] } => {
  const target = normalize(name);
  const exact: string[] = [];
  const similar: string[] = [];
  if (target.length === 0) {
    return { exact, similar };
  }
  for (const node of graph.nodes.values()) {
    const candidate = normalize(node.name);
    if (candidate === target) {
      exact.push(node.id);
    } else if (
      target.length >= 4 &&
      candidate.length >= 4 &&
      (candidate.includes(target) || target.includes(candidate))
    ) {
      similar.push(node.id);
    }
  }
  return { exact: exact.sort(), similar: similar.sort() };
};

const matchOne = (
  graph: KnowledgeGraph,
  concept: string,
  aliases: Readonly<Record<string, string>>,
): { mechanism: MatchMechanism; nodeIds: string[] } | undefined => {
  const direct = findByName(graph, concept);
  if (direct.exact.length > 0) {
    return { mechanism: 'exact', nodeIds: direct.exact };
  }
  const aliasTarget = aliases[concept] ?? aliases[concept.toLowerCase()];
  if (aliasTarget !== undefined) {
    const viaAlias = findByName(graph, aliasTarget);
    if (viaAlias.exact.length > 0) {
      return { mechanism: 'alias', nodeIds: viaAlias.exact };
    }
  }
  if (direct.similar.length > 0) {
    return { mechanism: 'name-similarity', nodeIds: direct.similar };
  }
  return undefined;
};

export const matchConcepts = (
  graph: KnowledgeGraph,
  concepts: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): ConceptMatchResult => {
  const matches: ConceptMatch[] = [];
  const unknownConcepts: string[] = [];
  for (const concept of [...new Set(concepts)].sort()) {
    const found = matchOne(graph, concept, aliases);
    if (found === undefined) {
      unknownConcepts.push(concept);
      continue;
    }
    const bounded = found.nodeIds.slice(0, MAX_MATCHES_PER_CONCEPT);
    for (const nodeId of bounded) {
      const node = graph.nodes.get(nodeId as never);
      matches.push({
        concept,
        nodeId,
        mechanism: found.mechanism,
        evidenceIds: node?.knowledge.evidenceIds ?? [],
        ambiguous: bounded.length > 1,
      });
    }
  }
  return { matches, unknownConcepts };
};
