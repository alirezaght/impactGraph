/**
 * What relationships a requirement proposes to create, read from the requirement itself.
 *
 * This is the piece that was missing. The motivating failure was discoverable from the
 * specification alone — "the newsletter service fetches subscriber preferences from the
 * user-profile service over HTTP" names both endpoints and the mechanism — but nothing turned that
 * sentence into a comparable relationship, so nothing could hold it up against the guard that
 * forbade it.
 *
 * Deterministic and deliberately shallow: a mechanism lexicon, and endpoints that must resolve to
 * something the repository knows about. A sentence that yields no mechanism yields no proposed
 * edge, because a proposal nobody can check is worse than no proposal at all.
 */

/** The mechanism a requirement describes, and the relationship it implies. */
export const PROPOSED_MECHANISMS = [
  'http',
  'import',
  'event',
  'direct-data-access',
  'configuration',
] as const;

export type ProposedMechanism = (typeof PROPOSED_MECHANISMS)[number];

interface MechanismRule {
  readonly mechanism: ProposedMechanism;
  readonly relation: string;
  readonly pattern: RegExp;
}

/**
 * Ordered: the first mechanism whose pattern fires wins. HTTP comes first because a sentence
 * describing an HTTP call between services frequently also says "call", which the weaker rules
 * would otherwise claim.
 */
const MECHANISM_RULES: readonly MechanismRule[] = [
  {
    mechanism: 'http',
    relation: 'CALLS_ENDPOINT',
    pattern:
      /\b(https?\b|rest\b|http call|api call|calls? the [\w-]*\s*(?:service|api)|fetch(?:es|ed)? from|requests? (?:from|to) the|service[- ]to[- ]service|peer[- ]service)\b/i,
  },
  {
    mechanism: 'event',
    relation: 'PUBLISHES',
    pattern:
      /\b(publish(?:es|ed)?|emit(?:s|ted)?|enqueue(?:s|d)?|pub\/?sub|topic|message queue)\b/i,
  },
  {
    mechanism: 'direct-data-access',
    relation: 'READS_FROM',
    pattern:
      /\b(quer(?:y|ies|ying)|read(?:s)? (?:from )?the [\w-]* (?:table|collection|database)|writes? directly to|direct(?:ly)? (?:access(?:es)?|read|write)s?)\b/i,
  },
  {
    mechanism: 'import',
    relation: 'IMPORTS',
    pattern: /\b(imports?|depends? on|uses the [\w-]+ (?:package|module|library)|requires? the)\b/i,
  },
  {
    mechanism: 'configuration',
    relation: 'CONFIGURES',
    pattern: /\b(configure[sd]?|sets? the environment|environment variables?|env var)\b/i,
  },
];

/** One endpoint of a proposed relationship. */
export interface ProposedEndpoint {
  /** The text the requirement used. */
  readonly ref: string;
  /** Resolved graph node, when the reference matched one. */
  readonly nodeId?: string;
  /** Repository path of the resolved node, used for scope matching. */
  readonly path?: string;
}

export interface ProposedEdge {
  readonly requirementId: string;
  readonly source: ProposedEndpoint;
  readonly target: ProposedEndpoint;
  readonly mechanism: ProposedMechanism;
  readonly relation: string;
  /** The sentence fragment the mechanism was read from — the evidence a reader checks. */
  readonly quote: string;
  /** 0..1. Lower when an endpoint did not resolve to an indexed component. */
  readonly confidence: number;
}

/** A component the requirement names, already resolved by concept matching. */
export interface ResolvedConcept {
  readonly ref: string;
  readonly nodeId?: string;
  readonly path?: string;
}

const quoteAround = (statement: string, index: number): string => {
  const start = Math.max(0, index - 60);
  return statement.slice(start, Math.min(statement.length, index + 120)).trim();
};

/**
 * Order the two endpoints by where the sentence puts them.
 *
 * Textual order is the rule, because that is the order English uses for "A calls B" and for
 * "A fetches X from B" alike — in both, the actor comes first. The one exception worth handling is
 * a fronted prepositional phrase ("from the user-profile service, newsletter reads …"), detected by
 * a `from` immediately before the FIRST endpoint rather than between the two.
 */
const orderEndpoints = (
  statement: string,
  first: ResolvedConcept,
  second: ResolvedConcept,
): readonly [ResolvedConcept, ResolvedConcept] => {
  const lower = statement.toLowerCase();
  const firstAt = lower.indexOf(first.ref.toLowerCase());
  const secondAt = lower.indexOf(second.ref.toLowerCase());
  if (firstAt === -1 || secondAt === -1) {
    return [first, second];
  }
  const [earlier, later] = firstAt <= secondAt ? [first, second] : [second, first];
  const earliestAt = Math.min(firstAt, secondAt);
  const fronted = /\bfrom\s+(?:the\s+)?$/i.test(
    statement.slice(Math.max(0, earliestAt - 12), earliestAt),
  );
  return fronted ? [later, earlier] : [earlier, later];
};

const endpointOf = (concept: ResolvedConcept): ProposedEndpoint => ({
  ref: concept.ref,
  ...(concept.nodeId === undefined ? {} : { nodeId: concept.nodeId }),
  ...(concept.path === undefined ? {} : { path: concept.path }),
});

/**
 * Confidence is a function of how much was READ rather than assumed: both endpoints resolved to
 * indexed components is the only case that earns a high figure, because only then can a reader
 * follow the finding to real code.
 */
const confidenceFor = (source: ProposedEndpoint, target: ProposedEndpoint): number => {
  const resolved = [source, target].filter((endpoint) => endpoint.nodeId !== undefined).length;
  return resolved === 2 ? 0.85 : resolved === 1 ? 0.6 : 0.4;
};

export interface DeriveProposedEdgesInput {
  readonly requirementId: string;
  readonly statement: string;
  /** Components the requirement names, in the order concept matching found them. */
  readonly concepts: readonly ResolvedConcept[];
}

/** The top-level container of a path — 'services/newsletter-service', 'apps/admin', 'infra'. */
const containerOfPath = (path: string | undefined): string | undefined => {
  if (path === undefined) {
    return undefined;
  }
  const segments = path.split('/');
  return segments.length <= 2 ? segments[0] : segments.slice(0, 2).join('/');
};

/**
 * Which two of the requirement's components the sentence relates.
 *
 * A requirement routinely names more than two things — both services AND the file the change lands
 * in — and "the first two" silently drops the real target, so the constraint check reads the wrong
 * relationship. A relationship a constraint can govern crosses a container boundary, so the first
 * textual pair whose resolved paths live in different top-level containers wins; a fragment of a
 * longer concept ("user-profile" inside "user-profile service") is never an endpoint of its own.
 */
const selectEndpoints = (
  statement: string,
  concepts: readonly ResolvedConcept[],
): readonly [ResolvedConcept, ResolvedConcept] => {
  const distinct = concepts.filter(
    (concept, index) =>
      !concepts.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.ref.length > concept.ref.length &&
          other.ref.toLowerCase().includes(concept.ref.toLowerCase()),
      ),
  );
  const pool = distinct.length >= 2 ? distinct : concepts;
  const lower = statement.toLowerCase();
  const at = (concept: ResolvedConcept): number => {
    const index = lower.indexOf(concept.ref.toLowerCase());
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const byPosition = [...pool].sort((a, b) => at(a) - at(b));
  for (const source of byPosition) {
    for (const target of byPosition.slice(byPosition.indexOf(source) + 1)) {
      const sourceContainer = containerOfPath(source.path);
      const targetContainer = containerOfPath(target.path);
      if (
        sourceContainer !== undefined &&
        targetContainer !== undefined &&
        sourceContainer !== targetContainer
      ) {
        return [source, target];
      }
    }
  }
  return [byPosition[0] as ResolvedConcept, byPosition[1] as ResolvedConcept];
};

/**
 * At most one proposed edge per mechanism per requirement. A requirement sentence that mentions
 * three services does not propose six relationships; inflating the count would flood the findings
 * with pairs nobody proposed.
 */
export const deriveProposedEdges = (input: DeriveProposedEdgesInput): readonly ProposedEdge[] => {
  if (input.concepts.length < 2) {
    return [];
  }
  const endpoints = selectEndpoints(input.statement, input.concepts);
  const edges: ProposedEdge[] = [];
  for (const rule of MECHANISM_RULES) {
    const match = rule.pattern.exec(input.statement);
    if (match === null) {
      continue;
    }
    const [first, second] = orderEndpoints(input.statement, endpoints[0], endpoints[1]);
    const source = endpointOf(first);
    const target = endpointOf(second);
    edges.push({
      requirementId: input.requirementId,
      source,
      target,
      mechanism: rule.mechanism,
      relation: rule.relation,
      quote: quoteAround(input.statement, match.index),
      confidence: confidenceFor(source, target),
    });
  }
  return edges;
};
