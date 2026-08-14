import { createPreflightFinding } from '@impactgraph/domain';

import type { GraphNode, KnowledgeGraph, PreflightFinding } from '@impactgraph/domain';

/**
 * Check that the members a specification asserts actually exist.
 *
 * `ItemType.ANGEBOT` was assumed, implemented against, and did not exist. Resolution stopped at the
 * file and the top-level symbol, so `ItemType` resolving was read as the reference resolving —
 * the qualifier existing was mistaken for the member existing.
 *
 * The distinction this analyzer must protect is the one between an invalid assumption and new
 * surface. `ItemType.ANGEBOT` missing from an indexed enum is a defect in the plan. A locale key
 * missing when the specification says "add a key" is not. The difference is whether the CONTAINER
 * is indexed and whether the sentence asserts or creates, and both are read, never guessed.
 */

/** Node types whose members are worth validating, and what a member of each is called. */
const MEMBER_CONTAINERS: Readonly<Record<string, string>> = {
  enum: 'enum member',
  class: 'member',
  interface: 'member',
  symbol: 'member',
  schema: 'field',
  'locale-bundle': 'translation key',
  'configuration-file': 'configuration key',
};

/** Node types that ARE members — the declared children a qualifier may have. */
const MEMBER_TYPES = new Set([
  'enum-member',
  'union-literal',
  'field',
  'column',
  'translation-key',
  'config-key',
  'feature-flag',
  'method',
]);

/**
 * `ItemType.ANGEBOT`, `Settings.SENDGRID_KEY`, `listing.id` — a qualified member reference in
 * prose. Widened (ADR-0020) to lowercase qualifiers and two-character members so SQL-style
 * references like `listing.id` are judgeable; the false-positive pressure stays at zero because
 * a reference is only ever judged when a container of that name is indexed AND declares members
 * (`judgeableContainer`), which prose coincidences do not survive.
 */
const QUALIFIED_MEMBER = /\b([A-Za-z][A-Za-z0-9_]+)\.([A-Za-z][A-Za-z0-9_]+)\b/g;

/**
 * `Node.js`, `models.py`, `package.json` — dotted tokens that are file or platform names, not
 * member references. Denied outright: a container named `Node` with members would otherwise turn
 * every mention of Node.js into a blocking finding.
 */
const FILE_EXTENSION_MEMBERS = new Set([
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'md',
  'go',
  'rs',
  'sh',
  'css',
  'yml',
  'yaml',
  'json',
  'toml',
  'txt',
  'html',
  'sql',
  'xml',
  'csv',
  'env',
  'lock',
]);

/**
 * Verbs that ASSERT the thing already exists, as opposed to creating it. Only assertions can be
 * invalid: "add ItemType.ANGEBOT" is a plan, "use ItemType.ANGEBOT" is a claim.
 */
const ASSERTION_CONTEXT =
  /\b(uses?|using|references?|reads?|checks?|matches?|equals?|is set to|returns?|when|if|existing|already)\b/i;
const CREATION_CONTEXT =
  /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|extend|extends)\b/i;

/**
 * The bare member name a node declares. Field and method nodes are named `Owner.member` (and TS
 * marks nullability with a trailing `?`), while enum members are named bare — comparing a prose
 * reference against the qualified form would report a declared member as missing, so the owner
 * prefix and the nullability marker are stripped before membership is judged.
 */
const bareMemberName = (container: GraphNode, target: GraphNode): string => {
  const name = target.name.endsWith('?') ? target.name.slice(0, -1) : target.name;
  const prefix = `${container.name}.`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
};

const declaredMembers = (graph: KnowledgeGraph, container: GraphNode): ReadonlySet<string> => {
  const members = new Set<string>();
  for (const edgeId of graph.outgoing.get(container.id) ?? []) {
    const edge = graph.edges.get(edgeId);
    if (edge === undefined || (edge.type !== 'DECLARES_MEMBER' && edge.type !== 'CONTAINS')) {
      continue;
    }
    const target = graph.nodes.get(edge.targetId);
    if (target !== undefined && MEMBER_TYPES.has(target.type)) {
      members.add(bareMemberName(container, target));
    }
  }
  return members;
};

/**
 * Containers indexed under this name, of a type whose members we model. An exact match wins; a
 * lowercase qualifier (`listing.id`, the SQL habit) additionally matches case-insensitively,
 * because prose and SQL lowercase names the code capitalizes (ADR-0020).
 */
const containersNamed = (graph: KnowledgeGraph, name: string): readonly GraphNode[] => {
  const judgeable = [...graph.nodes.values()].filter(
    (node) => MEMBER_CONTAINERS[node.type] !== undefined,
  );
  const exact = judgeable.filter((node) => node.name === name);
  if (exact.length > 0 || !/^[a-z]/.test(name)) {
    return exact;
  }
  const lower = name.toLowerCase();
  return judgeable.filter((node) => node.name.toLowerCase() === lower);
};

export interface AssumptionCheckInput {
  readonly requirementId: string;
  readonly statement: string;
  readonly graph: KnowledgeGraph;
  readonly nextId: (seed: string) => string;
}

const sentenceAround = (statement: string, index: number): string => {
  const before = statement.lastIndexOf('.', index) + 1;
  const after = statement.indexOf('.', index);
  return statement.slice(before, after === -1 ? statement.length : after).trim();
};

/**
 * Emitted only when the container is indexed AND declares at least one member. A container with no
 * declared members means the adapter did not extract members for that language — absence there is a
 * gap in the extractor, not a defect in the plan, and reporting it would be the fabricated finding
 * this system exists to avoid.
 */
/**
 * The container a reference should be judged against, or undefined when no judgement is possible.
 *
 * Undefined is returned for three distinct reasons, and all three must stay silent: the qualifier
 * is not indexed, the sentence CREATES the member rather than asserting it, or the container's
 * members were never extracted for that language.
 */
const judgeableContainer = (
  input: AssumptionCheckInput,
  qualifier: string,
  matchIndex: number,
): GraphNode | undefined => {
  const containers = containersNamed(input.graph, qualifier);
  if (containers.length === 0) {
    return undefined;
  }
  const sentence = sentenceAround(input.statement, matchIndex);
  if (CREATION_CONTEXT.test(sentence) && !ASSERTION_CONTEXT.test(sentence)) {
    return undefined;
  }
  return containers.find((container) => declaredMembers(input.graph, container).size > 0);
};

const invalidAssumption = (
  input: AssumptionCheckInput,
  container: GraphNode,
  qualifier: string,
  member: string,
): PreflightFinding | undefined => {
  const key = `${qualifier}.${member}`;
  const available = [...declaredMembers(input.graph, container)].sort();
  const result = createPreflightFinding({
    id: input.nextId(`${input.requirementId}:${key}`),
    kind: 'invalid-assumption',
    severity: 'blocking',
    requirementIds: [input.requirementId],
    statement: `Requirement ${input.requirementId} references ${key}, but ${member} is not a ${MEMBER_CONTAINERS[container.type] ?? 'member'} of ${qualifier} at the indexed revision.`,
    recommendation: `Use one of the declared members (${available.slice(0, 8).join(', ')}), or add ${member} to ${qualifier} as part of this change.`,
    subject: {
      assumedSymbol: key,
      nodeIds: [String(container.id)],
      ...(container.path === undefined ? {} : { filePaths: [container.path] }),
    },
    evidenceIds: [...container.knowledge.evidenceIds],
    confidence: 0.9,
    provenance: 'static-analysis',
    analyzer: 'check-assumptions',
  });
  return result.ok ? result.value : undefined;
};

export const checkAssumptions = (input: AssumptionCheckInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  const seen = new Set<string>();
  for (const match of input.statement.matchAll(QUALIFIED_MEMBER)) {
    const qualifier = match[1] ?? '';
    const member = match[2] ?? '';
    const key = `${qualifier}.${member}`;
    if (seen.has(key) || FILE_EXTENSION_MEMBERS.has(member)) {
      continue;
    }
    seen.add(key);
    const container = judgeableContainer(input, qualifier, match.index);
    if (container === undefined || declaredMembers(input.graph, container).has(member)) {
      continue;
    }
    const finding = invalidAssumption(input, container, qualifier, member);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }
  return findings;
};
