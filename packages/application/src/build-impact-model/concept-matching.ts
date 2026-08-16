import { isSpeculativeConcept } from '../analyze-specification/statement-analysis.js';

import { coversArchitecturalStem } from './architectural-stem.js';
import { assessUbiquity } from './dependency-ubiquity.js';
import { containerOf, containerRoots } from './top-level-container.js';

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
export type MatchMechanism =
  'exact' | 'alias' | 'path-segment' | 'name-similarity' | 'semantic' | 'lexical';

/**
 * An exact name that resolves to several nodes in DIFFERENT top-level containers. Field finding:
 * `require_internal_auth` existed in five unrelated services and every copy arrived `required` —
 * distance 0 with no warning. Same-named symbols in different packages are N coincidences until
 * something structural ties one of them to the requirement, so the collision is recorded on each
 * match and classification caps the tier at `possible` unless the node is corroborated.
 */
export interface ConceptCollision {
  /** How many nodes share the exact name. */
  readonly count: number;
  /** The distinct top-level containers those nodes live in, sorted. */
  readonly containers: readonly string[];
}

export interface ConceptMatch {
  readonly concept: string;
  readonly nodeId: string;
  readonly mechanism: MatchMechanism;
  readonly evidenceIds: readonly string[];
  /** True when this concept matched more than one node — feeds the ambiguity penalty (§14). */
  readonly ambiguous: boolean;
  /** True when the concept resolved only to test artifacts — feeds the §14 test-only penalty. */
  readonly testOnly: boolean;
  /** Present when the exact name exists in several top-level containers (see ConceptCollision). */
  readonly collision?: ConceptCollision;
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
    // all — never a fuzzy resemblance to the `GET /api/deals` display name. A repository file
    // path the specification wrote verbatim is exact for the same reason.
    if (
      normalize(node.name) === target ||
      normalize(node.route?.path ?? '') === target ||
      node.path === name
    ) {
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

/** Below this many normalized characters, a segment match is a coincidence ("api", "app"). */
const MIN_SEGMENT_CONCEPT_LENGTH = 6;

/**
 * A service that exists only as a directory — no manifest, no Terraform resource, no node NAMED
 * after it — is still a component a specification can name. A concept equal to a directory
 * segment resolves to the files under that directory, shallowest first, so plans that name such
 * a service can be checked against the constraints that govern its path. Bounded and marked
 * ambiguous: the concept names the container, and which file inside changes stays a guess.
 */
/** Node types that stand for a whole directory: the manifest-bearing container. */
const CONTAINER_TYPES = new Set(['package', 'workspace']);

/** Member-level node types a mined (speculative) concept may never claim by name coincidence. */
const MEMBER_TYPES = new Set([
  'union-literal',
  'enum-member',
  'config-key',
  'feature-flag',
  'translation-key',
]);

const inDirectory = (path: string, asPrefix: string | undefined, target: string): number => {
  const segments = path.split('/');
  if (asPrefix !== undefined) {
    return path.startsWith(asPrefix) ? asPrefix.split('/').length - 2 : -1;
  }
  return segments
    .slice(0, -1)
    .findIndex((segment) => normalize(segment) === target && normalize(segment).length > 0);
};

interface SegmentHits {
  readonly containers: GraphNode[];
  readonly files: { node: GraphNode; depth: number }[];
}

const collectSegmentHits = (
  graph: KnowledgeGraph,
  asPrefix: string | undefined,
  target: string,
): SegmentHits => {
  const hits: SegmentHits = { containers: [], files: [] };
  for (const node of graph.nodes.values()) {
    if (node.path === undefined) {
      continue;
    }
    const index = inDirectory(node.path, asPrefix, target);
    if (index < 0) {
      continue;
    }
    // The manifest-bearing container IS the directory: "apps/mcp-server" names one package, not
    // its five shallowest files. Only a directory with no container falls back to files.
    if (CONTAINER_TYPES.has(node.type) && node.path.split('/').length - index === 2) {
      hits.containers.push(node);
    } else if (node.type === 'file') {
      hits.files.push({ node, depth: node.path.split('/').length - index });
    }
  }
  return hits;
};

const findByPathSegment = (graph: KnowledgeGraph, concept: string): GraphNode[] => {
  const target = normalize(concept);
  const asPrefix = concept.includes('/') ? `${concept.replace(/\/+$/, '')}/` : undefined;
  if (asPrefix === undefined && target.length < MIN_SEGMENT_CONCEPT_LENGTH) {
    return [];
  }
  const { containers, files } = collectSegmentHits(graph, asPrefix, target);
  if (containers.length > 0) {
    return containers.sort((a, b) => a.id.localeCompare(b.id));
  }
  return files
    .sort((a, b) => a.depth - b.depth || a.node.id.localeCompare(b.node.id))
    .map((hit) => hit.node);
};

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
  // A mined phrase may not claim a symbol MEMBER: 'evidence-backed' coinciding with a status
  // union literal is a coincidence of vocabulary, not the spec naming a component — and it once
  // arrived at required-tier because exact matches score highest.
  const exactPool = isSpeculativeConcept(concept)
    ? direct.exact.filter((node) => !MEMBER_TYPES.has(node.type))
    : direct.exact;
  if (exactPool.length > 0) {
    const nodes = usable(exactPool);
    return nodes.length === 0 ? 'ambiguous' : { mechanism: 'exact', nodes };
  }
  const aliasTarget = aliases[concept] ?? aliases[concept.toLowerCase()];
  if (aliasTarget !== undefined) {
    const viaAlias = usable(findByName(graph, aliasTarget).exact);
    if (viaAlias.length > 0) {
      return { mechanism: 'alias', nodes: viaAlias };
    }
  }
  return fuzzyResolution(graph, concept, usable, direct.similar);
};

/**
 * The fallback tiers, tried only after exact and alias matching found nothing: fuzzy name
 * similarity first, then directory-segment equality. Ranked this way so a segment match can never
 * change what a named node resolves to.
 *
 * A SPECULATIVE concept — mined from prose rather than written as an identifier — skips the
 * similarity tier entirely: it resolves strongly or not at all. One mined phrase ('mcp-server')
 * once similarity-matched every server.ts in the repository including test fixtures, turning a
 * 21-impact analysis into a 214-impact one. Mining candidates is cheap; the license to fuzz is
 * reserved for names the author actually wrote.
 */
const fuzzyResolution = (
  graph: KnowledgeGraph,
  concept: string,
  usable: (nodes: readonly GraphNode[]) => GraphNode[],
  rawSimilar: readonly GraphNode[],
): Resolution | 'ambiguous' | undefined => {
  const speculative = isSpeculativeConcept(concept);
  const similar = speculative ? [] : usable(rawSimilar);
  if (similar.length > 0 && similar.length <= MAX_SIMILAR_MATCHES) {
    return { mechanism: 'name-similarity', nodes: similar };
  }
  const bySegment = usable(findByPathSegment(graph, concept));
  if (bySegment.length > 0) {
    return { mechanism: 'path-segment', nodes: bySegment };
  }
  if (speculative) {
    return undefined;
  }
  return similar.length > MAX_SIMILAR_MATCHES || rawSimilar.length > 0 ? 'ambiguous' : undefined;
};

/**
 * A concept qualified by a path or a file extension names one specific place; only a bare
 * identifier can coincidentally exist in several containers, so only bare identifiers collide.
 */
const isPathQualified = (concept: string): boolean =>
  concept.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(concept);

interface CollisionAssessment {
  /** True when some same-kind group collides beyond MAX_SIMILAR_MATCHES — the concept escalates. */
  readonly escalate: boolean;
  /** Collision record per colliding node id; correspondence partners are absent. */
  readonly byNodeId: ReadonlyMap<string, ConceptCollision>;
}

const NO_COLLISIONS: CollisionAssessment = { escalate: false, byNodeId: new Map() };

/**
 * The exact-collision guard. Assessed AFTER test artifacts are dropped — a production symbol
 * whose only same-named twin is a test double is not a collision — and only for exact matches:
 * an alias is a human-maintained mapping (the human said which component was meant), and fuzzy
 * matches already carry the MAX_SIMILAR_MATCHES escalation.
 *
 * Only nodes of the SAME category collide. Five same-named symbols in five services are five
 * coincidences; a package, the Terraform resource that deploys it, and the topic it publishes to
 * sharing one name are ONE component manifesting across stacks — the §C16 correspondence the
 * engine exists to surface, never a collision. Nodes whose container cannot be determined are
 * ignored rather than guessed, so an indeterminate graph keeps today's behavior.
 */
const groupCollision = (
  group: readonly GraphNode[],
  roots: readonly string[],
): ConceptCollision | undefined => {
  const containers = new Set<string>();
  for (const node of group) {
    const container = containerOf(node, roots);
    if (container !== undefined) {
      containers.add(container);
    }
  }
  if (group.length < 2 || containers.size < 2) {
    return undefined;
  }
  return { count: group.length, containers: [...containers].sort() };
};

const assessCollisions = (
  concept: string,
  mechanism: MatchMechanism,
  nodes: readonly GraphNode[],
  roots: () => readonly string[],
): CollisionAssessment => {
  if (mechanism !== 'exact' || nodes.length < 2 || isPathQualified(concept)) {
    return NO_COLLISIONS;
  }
  const byCategory = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    byCategory.set(node.category, [...(byCategory.get(node.category) ?? []), node]);
  }
  const byNodeId = new Map<string, ConceptCollision>();
  let escalate = false;
  for (const group of byCategory.values()) {
    const collision = groupCollision(group, roots());
    if (collision === undefined) {
      continue;
    }
    escalate = escalate || collision.count > MAX_SIMILAR_MATCHES;
    for (const node of group) {
      byNodeId.set(node.id, collision);
    }
  }
  return { escalate, byNodeId };
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
  // Lazy: the roots scan only runs when an exact name actually resolved to several nodes.
  let cachedRoots: readonly string[] | undefined;
  const roots = (): readonly string[] => (cachedRoots ??= containerRoots(graph));
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
    const collisions = assessCollisions(concept, found.mechanism, ranked.nodes, roots);
    // Past the same bound the fuzzy overflow uses, a cross-container collision is the same
    // situation — too many unrelated places to anchor — and takes the same exit: the existing
    // ambiguous-concept warning instead of an impact per coincidence.
    if (collisions.escalate) {
      ambiguousConcepts.push(concept);
      continue;
    }
    const bounded = ranked.nodes.slice(0, MAX_MATCHES_PER_CONCEPT);
    for (const node of bounded) {
      const collision = collisions.byNodeId.get(node.id);
      matches.push({
        concept,
        nodeId: node.id,
        mechanism: found.mechanism,
        evidenceIds: node.knowledge.evidenceIds,
        ambiguous: bounded.length > 1,
        testOnly: ranked.testOnly,
        ...(collision === undefined ? {} : { collision }),
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
