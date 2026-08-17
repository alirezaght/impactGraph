import { createPreflightFinding, resolveMember } from '@impactgraph/domain';

import type {
  GraphNode,
  KnowledgeGraph,
  MemberResolution,
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
 *
 * Membership itself is judged through the inheritance closure (`resolveMember`), never against one
 * node's own edges: `SqlOutboundQueueRepository.list_rows` was once declared nonexistent while
 * `list_rows` sat on a mixin the class extends. And when a base type lives outside the index, the
 * honest verdict is "could not verify" — a warning — never a blocking claim of nonexistence.
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

/** One container judged against a member it does not have, plus what the search covered. */
interface JudgedAbsence {
  readonly container: GraphNode;
  readonly resolution: Extract<MemberResolution, { outcome: 'not-found' }>;
}

/**
 * Rosters that are syntactically complete, so an unresolved base can never hide members.
 *
 * `class ItemType(str, Enum)` always extends the stdlib Enum — an unresolved supertype by
 * construction — yet its member roster IS its class body. Treating that as an open member set
 * would degrade every enum absence, ANGEBOT included, to "could not verify". Closure is judged
 * twice, because the signal lives in two places: container types that have no inheritance at all
 * (a TS `enum` node, a locale bundle, a config file), and member kinds that are declaration-closed
 * wherever they sit (a Python enum class is a `class` node whose members are `enum-member`s).
 * `method`/`field` rosters stay open — a mixin outside the index is exactly what extends them.
 */
const CLOSED_CONTAINER_TYPES = new Set(['enum', 'locale-bundle', 'configuration-file']);
const CLOSED_MEMBER_KINDS = new Set([
  'enum-member',
  'union-literal',
  'translation-key',
  'config-key',
  'feature-flag',
]);

const memberSetOpenFor = (judged: JudgedAbsence): boolean =>
  judged.resolution.memberSetOpen &&
  !CLOSED_CONTAINER_TYPES.has(judged.container.type) &&
  !judged.resolution.declaredMemberTypes.some((type) => CLOSED_MEMBER_KINDS.has(type));

/**
 * The judgement of one prose reference against every same-named indexed container. Silence has
 * four distinct reasons, all deliberate: the qualifier is not indexed, the sentence CREATES the
 * member rather than asserting it, some container (or a base type it resolves to) declares the
 * member, or member extraction produced nothing anywhere in any hierarchy — absence there is a gap
 * in the extractor, not a defect in the plan, and reporting it would be the fabricated finding
 * this system exists to avoid.
 */
const judgeReference = (
  input: AssumptionCheckInput,
  qualifier: string,
  member: string,
  matchIndex: number,
): JudgedAbsence | undefined => {
  const containers = containersNamed(input.graph, qualifier);
  if (containers.length === 0) {
    return undefined;
  }
  const sentence = sentenceAround(input.statement, matchIndex);
  if (CREATION_CONTEXT.test(sentence) && !ASSERTION_CONTEXT.test(sentence)) {
    return undefined;
  }
  const absences: JudgedAbsence[] = [];
  for (const container of containers) {
    const resolution = resolveMember(input.graph, container, member, {
      memberTypes: MEMBER_TYPES,
    });
    if (resolution.outcome === 'found') {
      return undefined; // declared on the container itself or inherited — the assumption holds
    }
    if (resolution.declaredMemberNames.length > 0) {
      absences.push({ container, resolution });
    }
  }
  // A member set that is open anywhere caps the claim at "could not verify" for the reference.
  return absences.find(memberSetOpenFor) ?? absences[0];
};

const findingSubject = (container: GraphNode, key: string): PreflightFinding['subject'] => ({
  assumedSymbol: key,
  nodeIds: [String(container.id)],
  ...(container.path === undefined ? {} : { filePaths: [container.path] }),
});

/**
 * Open world: the container inherits from a type the index cannot see, so nonexistence is not a
 * fact the structural model can state. `coverage-gap` by design — the domain forbids that kind
 * from ever being blocking, so this can never turn into a BLOCKED verdict by a severity edit.
 */
const unverifiableAssumption = (
  input: AssumptionCheckInput,
  judged: JudgedAbsence,
  qualifier: string,
  member: string,
): PreflightFinding | undefined => {
  const key = `${qualifier}.${member}`;
  const result = createPreflightFinding({
    id: input.nextId(`${input.requirementId}:${key}`),
    kind: 'coverage-gap',
    severity: 'warning',
    requirementIds: [input.requirementId],
    statement: `Requirement ${input.requirementId} references ${key}, but ${member} could not be verified: not found on ${qualifier} or its resolved base types; ${qualifier} inherits from types outside the index.`,
    recommendation: `Confirm ${member} exists on a base type of ${qualifier} that lives outside the indexed scope, or index the repository that declares it and re-run the analysis.`,
    subject: findingSubject(judged.container, key),
    evidenceIds: [...judged.container.knowledge.evidenceIds],
    confidence: 0.6,
    provenance: 'static-analysis',
    analyzer: 'check-assumptions',
  });
  return result.ok ? result.value : undefined;
};

/** Closed world: every reachable base type is indexed, and the statement says what was searched. */
const invalidAssumption = (
  input: AssumptionCheckInput,
  judged: JudgedAbsence,
  qualifier: string,
  member: string,
): PreflightFinding | undefined => {
  const { container, resolution } = judged;
  const key = `${qualifier}.${member}`;
  const searched =
    resolution.resolvedSupertypeCount === 0
      ? `${member} is not a ${MEMBER_CONTAINERS[container.type] ?? 'member'} of ${qualifier} at the indexed revision`
      : `${member} was not found on ${qualifier} or its ${String(resolution.resolvedSupertypeCount)} resolved base type(s) at the indexed revision`;
  const result = createPreflightFinding({
    id: input.nextId(`${input.requirementId}:${key}`),
    kind: 'invalid-assumption',
    severity: 'blocking',
    requirementIds: [input.requirementId],
    statement: `Requirement ${input.requirementId} references ${key}, but ${searched}.`,
    recommendation: `Use one of the declared members (${resolution.declaredMemberNames.slice(0, 8).join(', ')}), or add ${member} to ${qualifier} as part of this change.`,
    subject: findingSubject(container, key),
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
    const judged = judgeReference(input, qualifier, member, match.index);
    if (judged === undefined) {
      continue;
    }
    const finding = memberSetOpenFor(judged)
      ? unverifiableAssumption(input, judged, qualifier, member)
      : invalidAssumption(input, judged, qualifier, member);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }
  return findings;
};
