import { createPreflightFinding } from '@impactgraph/domain';

import type {
  EdgeId,
  GraphNode,
  KnowledgeGraph,
  NodeId,
  PreflightFinding,
} from '@impactgraph/domain';

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

/** `ItemType.ANGEBOT`, `Settings.SENDGRID_KEY` — a qualified member reference in prose. */
const QUALIFIED_MEMBER = /\b([A-Z][A-Za-z0-9_]{2,})\.([A-Z][A-Z0-9_]{2,}|[a-z][A-Za-z0-9_]{2,})\b/g;

/**
 * Verbs that ASSERT the thing already exists, as opposed to creating it. Only assertions can be
 * invalid: "add ItemType.ANGEBOT" is a plan, "use ItemType.ANGEBOT" is a claim.
 */
const ASSERTION_CONTEXT =
  /\b(uses?|using|references?|reads?|checks?|matches?|equals?|is set to|returns?|when|if|existing|already)\b/i;
const CREATION_CONTEXT = /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|extend|extends)\b/i;

const declaredMembers = (graph: KnowledgeGraph, container: GraphNode): ReadonlySet<string> => {
  const members = new Set<string>();
  for (const edgeId of graph.outgoing.get(container.id) ?? []) {
    const edge = graph.edges.get(edgeId as EdgeId);
    if (edge === undefined || (edge.type !== 'DECLARES_MEMBER' && edge.type !== 'CONTAINS')) {
      continue;
    }
    const target = graph.nodes.get(edge.targetId as NodeId);
    if (target !== undefined && MEMBER_TYPES.has(target.type)) {
      members.add(target.name);
    }
  }
  return members;
};

/** Containers indexed under this name, of a type whose members we model. */
const containersNamed = (graph: KnowledgeGraph, name: string): readonly GraphNode[] =>
  [...graph.nodes.values()].filter(
    (node) => node.name === name && MEMBER_CONTAINERS[node.type] !== undefined,
  );

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
export const checkAssumptions = (input: AssumptionCheckInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  const seen = new Set<string>();
  for (const match of input.statement.matchAll(QUALIFIED_MEMBER)) {
    const qualifier = match[1] ?? '';
    const member = match[2] ?? '';
    const key = `${qualifier}.${member}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const containers = containersNamed(input.graph, qualifier);
    if (containers.length === 0) {
      continue;
    }
    const sentence = sentenceAround(input.statement, match.index);
    if (CREATION_CONTEXT.test(sentence) && !ASSERTION_CONTEXT.test(sentence)) {
      continue;
    }
    const withMembers = containers.filter(
      (container) => declaredMembers(input.graph, container).size > 0,
    );
    if (withMembers.length === 0) {
      continue;
    }
    const exists = withMembers.some((container) =>
      declaredMembers(input.graph, container).has(member),
    );
    if (exists) {
      continue;
    }
    const container = withMembers[0] as GraphNode;
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
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};
