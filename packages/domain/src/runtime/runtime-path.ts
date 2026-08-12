/**
 * The path traffic actually takes, as opposed to the path the source code suggests.
 *
 * The motivating failure: a change set environment variables on `newsletter-service`, which is what
 * both the code and the plan named. Admin traffic reached it through an aggregator container that
 * never received them, producing a live 503. Every hop of that chain was in the repository —
 * `NEWSLETTER_SERVICE_URL` → `frontend_service_urls.newsletter` → `_agg.newsletter` → the aggregator
 * container — but nothing modelled the chain, so nothing could notice that the configuration was
 * applied to a process that was not on it.
 */

/** What kind of thing a hop is. Each maps to an indexed node. */
export const RUNTIME_HOP_KINDS = [
  /** Where the request starts: a frontend page, a job, an external caller. */
  'caller',
  /** A configured URL as the caller knows it. */
  'configured-url',
  /** A Terraform local, output or variable that the URL resolves through. */
  'resolution',
  /** A deployed resource: a Cloud Run service, a load balancer, a gateway. */
  'runtime-resource',
  /** The container or process inside that resource which actually runs. */
  'process',
  /** The code that handles the request once it arrives. */
  'handler',
] as const;

export type RuntimeHopKind = (typeof RUNTIME_HOP_KINDS)[number];

export interface RuntimeHop {
  readonly kind: RuntimeHopKind;
  readonly nodeId: string;
  readonly name: string;
  /** The edge type traversed to reach this hop from the previous one. */
  readonly viaRelation?: string;
  readonly evidenceIds: readonly string[];
  /**
   * Set when the hop was inferred rather than read — e.g. a variable whose value is assembled at
   * deploy time. A path containing an inferred hop can warn but must never block.
   */
  readonly inferred?: boolean;
}

export interface RuntimePath {
  readonly id: string;
  /** Environment this path describes, when the repository distinguishes them. */
  readonly environment?: string;
  readonly hops: readonly RuntimeHop[];
  /**
   * Where the chain stopped short of a handler, if it did. An incomplete path is reported as
   * incomplete; it is never presented as a complete answer with the tail quietly dropped.
   */
  readonly incompleteReason?: string;
}

/** Configuration a surface needs in order to work. */
export interface ConfigRequirement {
  readonly name: string;
  /** The node that declares the need — a settings key, a client constructor, a guard. */
  readonly requiredByNodeId: string;
  readonly evidenceIds: readonly string[];
}

export const RUNTIME_GAP_KINDS = [
  /** A process on the path does not receive a required configuration value. */
  'missing-config-on-path',
  /** The path resolves to a process the plan never mentions. */
  'unplanned-serving-process',
  /** The chain could not be completed, so no claim about the path is possible. */
  'unresolved-path',
] as const;

export type RuntimeGapKind = (typeof RUNTIME_GAP_KINDS)[number];

export interface RuntimeGap {
  readonly kind: RuntimeGapKind;
  readonly pathId: string;
  /** The hop at which the gap occurs. */
  readonly atNodeId: string;
  readonly atName: string;
  /** Configuration names missing at that hop, for `missing-config-on-path`. */
  readonly missingConfig?: readonly string[];
  readonly explanation: string;
  readonly evidenceIds: readonly string[];
}

/** The process hops of a path — the ones that can be given, or denied, configuration. */
export const processHops = (path: RuntimePath): readonly RuntimeHop[] =>
  path.hops.filter((hop) => hop.kind === 'process' || hop.kind === 'runtime-resource');

/** True when every hop was read rather than inferred, and the chain reached a handler. */
export const isFullyResolved = (path: RuntimePath): boolean =>
  path.incompleteReason === undefined &&
  path.hops.every((hop) => hop.inferred !== true) &&
  path.hops.some((hop) => hop.kind === 'handler');

/**
 * Compare configuration a plan applies against what the path needs.
 *
 * `configuredNodeIds` is what the plan touches; `requirements` is what the path's processes need.
 * A requirement whose declaring process is on the path but is NOT among the configured nodes is the
 * 503 waiting to happen.
 */
export const findConfigGaps = (
  path: RuntimePath,
  requirements: readonly ConfigRequirement[],
  configuredByNodeId: ReadonlyMap<string, ReadonlySet<string>>,
): readonly RuntimeGap[] => {
  const gaps: RuntimeGap[] = [];
  for (const hop of processHops(path)) {
    const provided = configuredByNodeId.get(hop.nodeId) ?? new Set<string>();
    const missing = requirements
      .map((requirement) => requirement.name)
      .filter((name) => !provided.has(name));
    if (missing.length === 0) {
      continue;
    }
    gaps.push({
      kind: 'missing-config-on-path',
      pathId: path.id,
      atNodeId: hop.nodeId,
      atName: hop.name,
      missingConfig: [...new Set(missing)].sort(),
      explanation: `${hop.name} is on the request path but does not receive ${missing.join(', ')}`,
      evidenceIds: hop.evidenceIds,
    });
  }
  return gaps;
};
