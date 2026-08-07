import { coversArchitecturalStem } from './architectural-stem.js';
import { assessUbiquity } from './dependency-ubiquity.js';

import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Story 6.1 — concept-to-node matching. Every match records which mechanism produced it (the
// match-strength signal for the confidence engine); unknown concepts become warnings, never
// invented nodes.

/**
 * How a concept reached a node.
 *
 * `exact` / `alias` / `name-similarity` are identifier-grade: the specification named the thing, or
 * named it closely enough that token alignment and character coverage both hold.
 *
 * `semantic` and `lexical` are the two weaker mechanisms the conceptual search contributes (item 4).
 * They exist so conceptual queries can find anything at all, and they are labelled so the impact
 * engine can cap what they are allowed to claim: `lexical` never rises above the `lexical-only`
 * tier, whatever else corroborates it.
 */
export type MatchMechanism = 'exact' | 'alias' | 'name-similarity' | 'semantic' | 'lexical';

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
  /**
   * Cases where a dependency's eligibility could not be established. Reported rather than guessed:
   * an undeterminable ecosystem never suppresses a match, so the user learns why a broad-looking
   * dependency was still allowed to anchor.
   */
  readonly eligibilityNotes: readonly string[];
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_MATCHES_PER_CONCEPT = 5;

/** Above this, a similarity-only concept is treated as unresolved rather than matched. */
const MAX_SIMILAR_MATCHES = 3;

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
export const nameCoverage = (concept: string, name: string): number => {
  const conceptLength = normalize(concept).length;
  const nameLength = normalize(withoutExtension(name)).length;
  const longer = Math.max(conceptLength, nameLength);
  return longer === 0 ? 0 : Math.min(conceptLength, nameLength) / longer;
};

export const tokensAlign = (concept: string, name: string): boolean => {
  const conceptTokens = tokensOf(concept);
  const nameTokens = tokensOf(name);
  const [shorterTokens, longerTokens] =
    conceptTokens.length <= nameTokens.length
      ? [conceptTokens, nameTokens]
      : [nameTokens, conceptTokens];
  return shorterTokens.length > 0 && containsRun(longerTokens, shorterTokens);
};

/** `minCoverage` is a seam for calibration; production always uses the constant above. */
const isSimilar = (concept: string, name: string, minCoverage = MIN_NAME_COVERAGE): boolean => {
  if (tokensAlign(concept, name) && nameCoverage(concept, name) >= minCoverage) {
    return true;
  }
  // ADR-0016: a concept covering the whole stem of a conventionally-suffixed component name
  // ("deals" → DealsController) is similarity-grade too. Same mechanism, so the same guards apply
  // (ambiguity escalation, MAX_SIMILAR_MATCHES, test/ubiquity suppression) and the same
  // `name-similarity` basis caps it at `likely` — the ceiling is what makes this widening safe.
  return coversArchitecturalStem(tokensOf(concept), tokensOf(name));
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
    // A declared route path is an identifier the specification can name (§12.1.1): a concept
    // equal to it is exact-grade on EVERY verb served at that path — a path move obliges them
    // all — never a fuzzy resemblance to the `GET /api/deals` display name.
    if (normalize(node.name) === target || normalize(node.route?.path ?? '') === target) {
      exact.push(node);
    } else if (isSimilar(name, node.name)) {
      similar.push(node);
    }
  }
  const byId = (a: GraphNode, b: GraphNode): number => a.id.localeCompare(b.id);
  return { exact: exact.sort(byId), similar: similar.sort(byId) };
};

interface Resolution {
  readonly mechanism: MatchMechanism;
  readonly nodes: readonly GraphNode[];
}

const resolve = (
  graph: KnowledgeGraph,
  concept: string,
  aliases: Readonly<Record<string, string>>,
  notes: string[],
): Resolution | 'ambiguous' | undefined => {
  const usable = (nodes: readonly GraphNode[]): GraphNode[] =>
    nodes.filter((node) => {
      if (node.type !== 'third-party-service') {
        return true;
      }
      const assessment = assessUbiquity(graph, node);
      if (assessment.diagnostic !== undefined) {
        notes.push(assessment.diagnostic);
      }
      return !assessment.ubiquitous;
    });
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
  const notes: string[] = [];
  for (const concept of [...new Set(concepts)].sort()) {
    const found = resolve(graph, concept, aliases, notes);
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
  return {
    matches,
    unknownConcepts,
    ambiguousConcepts,
    eligibilityNotes: [...new Set(notes)].sort(),
  };
};
