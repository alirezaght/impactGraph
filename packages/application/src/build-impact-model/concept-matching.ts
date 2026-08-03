import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

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
  /** True when the concept resolved only to test artifacts — feeds the §14 test-only penalty. */
  readonly testOnly: boolean;
}

export interface ConceptMatchResult {
  readonly matches: readonly ConceptMatch[];
  readonly unknownConcepts: readonly string[];
  /**
   * Concepts that spread too thinly over too many nodes to anchor a traversal. Reported so the
   * clarification engine can ask which component was meant, rather than seeding an impact per
   * coincidental name collision.
   */
  readonly ambiguousConcepts: readonly string[];
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_MATCHES_PER_CONCEPT = 5;

/** Above this, a similarity-only concept is treated as unresolved rather than matched. */
const MAX_SIMILAR_MATCHES = 3;

/**
 * A dependency more than this fraction of the workspace declares is shared tooling, not a
 * discriminating anchor: predicting "every package" narrows nothing, and it is how a word like
 * "TypeScript" in "exclude TypeScript sources" reaches the compiler every package builds with.
 */
const UBIQUITOUS_DEPENDENCY_SHARE = 0.5;

/**
 * The share is meaningless below this many declarers: a single-package repository declares
 * everything in 100% of its packages, which would make every dependency un-anchorable in most
 * repositories. Being declared two or three times is not ubiquity at any repository size.
 */
const MIN_UBIQUITOUS_DECLARERS = 4;

/** A similar name must be at least this fraction concept, measured in characters. */
const MIN_NAME_COVERAGE = 0.6;

const TEST_DIRECTORY = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE_SUFFIX = /\.(test|spec)\.[a-z0-9]+$/i;

/**
 * Test doubles mirror the production interfaces they stand in for, so they collide by name with
 * the very concepts a specification names. A double is not the thing to change.
 */
const isTestNode = (node: GraphNode): boolean =>
  node.type === 'test' ||
  (node.path !== undefined && (TEST_DIRECTORY.test(node.path) || TEST_FILE_SUFFIX.test(node.path)));

/** A trailing file extension is not part of the identifier a specification would name. */
const withoutExtension = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

const tokensOf = (value: string): string[] =>
  withoutExtension(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const containsRun = (haystack: readonly string[], needle: readonly string[]): boolean => {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) {
      return true;
    }
  }
  return false;
};

/**
 * Similarity needs two things, not substring containment.
 *
 * Token alignment: the shorter name must occupy whole tokens of the longer one, so "index" does
 * not match "reindexer".
 *
 * Character coverage: the shorter name must make up most of the longer one. Coverage is measured
 * in characters rather than tokens because casing decides how many tokens a word splits into —
 * "TypeScript" splits into type+script while "typescript" stays one token, and a token ratio
 * would then accept "TypeScript" ≈ "TypeScriptAdapter" (2 of 3 tokens) while rejecting the same
 * pair spelled in kebab-case. Characters make the same word behave the same way in every casing.
 */
const isSimilar = (concept: string, name: string): boolean => {
  const conceptTokens = tokensOf(concept);
  const nameTokens = tokensOf(name);
  const [shorterTokens, longerTokens] =
    conceptTokens.length <= nameTokens.length
      ? [conceptTokens, nameTokens]
      : [nameTokens, conceptTokens];
  if (shorterTokens.length === 0 || !containsRun(longerTokens, shorterTokens)) {
    return false;
  }
  const conceptLength = normalize(concept).length;
  const nameLength = normalize(withoutExtension(name)).length;
  const shorter = Math.min(conceptLength, nameLength);
  const longer = Math.max(conceptLength, nameLength);
  return longer > 0 && shorter / longer >= MIN_NAME_COVERAGE;
};

const findByName = (
  graph: KnowledgeGraph,
  name: string,
): { exact: GraphNode[]; similar: GraphNode[] } => {
  const target = normalize(name);
  const exact: GraphNode[] = [];
  const similar: GraphNode[] = [];
  if (target.length === 0) {
    return { exact, similar };
  }
  for (const node of graph.nodes.values()) {
    if (normalize(node.name) === target) {
      exact.push(node);
    } else if (isSimilar(name, node.name)) {
      similar.push(node);
    }
  }
  const byId = (a: GraphNode, b: GraphNode): number => a.id.localeCompare(b.id);
  return { exact: exact.sort(byId), similar: similar.sort(byId) };
};

const declarerCount = (graph: KnowledgeGraph, node: GraphNode): number => {
  let count = 0;
  for (const edgeId of graph.incoming.get(node.id) ?? []) {
    if (graph.edges.get(edgeId)?.type === 'DEPENDS_ON') {
      count += 1;
    }
  }
  return count;
};

const isUbiquitousDependency = (
  graph: KnowledgeGraph,
  node: GraphNode,
  packageCount: number,
): boolean => {
  if (node.type !== 'third-party-service' || packageCount <= 0) {
    return false;
  }
  const declarers = declarerCount(graph, node);
  return (
    declarers >= MIN_UBIQUITOUS_DECLARERS && declarers > packageCount * UBIQUITOUS_DEPENDENCY_SHARE
  );
};

interface Resolution {
  readonly mechanism: MatchMechanism;
  readonly nodes: readonly GraphNode[];
}

const resolve = (
  graph: KnowledgeGraph,
  concept: string,
  aliases: Readonly<Record<string, string>>,
  packageCount: number,
): Resolution | 'ambiguous' | undefined => {
  const usable = (nodes: readonly GraphNode[]): GraphNode[] =>
    nodes.filter((node) => !isUbiquitousDependency(graph, node, packageCount));
  const direct = findByName(graph, concept);
  if (direct.exact.length > 0) {
    const nodes = usable(direct.exact);
    return nodes.length === 0 ? 'ambiguous' : { mechanism: 'exact', nodes };
  }
  const aliasTarget = aliases[concept] ?? aliases[concept.toLowerCase()];
  if (aliasTarget !== undefined) {
    const viaAlias = usable(findByName(graph, aliasTarget).exact);
    if (viaAlias.length > 0) {
      return { mechanism: 'alias', nodes: viaAlias };
    }
  }
  const similar = usable(direct.similar);
  if (similar.length === 0) {
    return direct.similar.length === 0 ? undefined : 'ambiguous';
  }
  if (similar.length > MAX_SIMILAR_MATCHES) {
    return 'ambiguous';
  }
  return { mechanism: 'name-similarity', nodes: similar };
};

/** Production code wins outright; a test-only resolution is kept but marked. */
const preferProduction = (
  nodes: readonly GraphNode[],
): { nodes: GraphNode[]; testOnly: boolean } => {
  const production = nodes.filter((node) => !isTestNode(node));
  return production.length > 0
    ? { nodes: production, testOnly: false }
    : { nodes: [...nodes], testOnly: true };
};

export const matchConcepts = (
  graph: KnowledgeGraph,
  concepts: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): ConceptMatchResult => {
  const matches: ConceptMatch[] = [];
  const unknownConcepts: string[] = [];
  const ambiguousConcepts: string[] = [];
  let packageCount = 0;
  for (const node of graph.nodes.values()) {
    if (node.type === 'package') {
      packageCount += 1;
    }
  }
  for (const concept of [...new Set(concepts)].sort()) {
    const found = resolve(graph, concept, aliases, packageCount);
    if (found === undefined) {
      unknownConcepts.push(concept);
      continue;
    }
    if (found === 'ambiguous') {
      ambiguousConcepts.push(concept);
      continue;
    }
    const ranked = preferProduction(found.nodes);
    const bounded = ranked.nodes.slice(0, MAX_MATCHES_PER_CONCEPT);
    for (const node of bounded) {
      matches.push({
        concept,
        nodeId: node.id,
        mechanism: found.mechanism,
        evidenceIds: node.knowledge.evidenceIds,
        ambiguous: bounded.length > 1,
        testOnly: ranked.testOnly,
      });
    }
  }
  return { matches, unknownConcepts, ambiguousConcepts };
};
