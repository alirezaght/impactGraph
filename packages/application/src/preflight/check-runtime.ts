import { createPreflightFinding, findConfigGaps, processHops } from '@impactgraph/domain';

import type {
  ConfigRequirement,
  PreflightFinding,
  RuntimeGap,
  RuntimePath,
} from '@impactgraph/domain';

/**
 * Compare the configuration a plan applies against the configuration the request path needs.
 *
 * The 503 came from a plan that was correct about the service and silent about the process. Both
 * facts were available; nothing put them together. This analyzer is that comparison, and it is why
 * the runtime graph had to exist separately from the source graph.
 */

export interface CheckRuntimeInput {
  /** Paths the plan's traffic is expected to take. */
  readonly paths: readonly RuntimePath[];
  /** Configuration the plan says the feature needs. */
  readonly requirements: readonly ConfigRequirement[];
  /** Environment names each process actually receives, keyed by process node id. */
  readonly configuredByProcess: ReadonlyMap<string, ReadonlySet<string>>;
  /** Node ids the plan itself touches — what the change actually configures. */
  readonly planConfiguredNodeIds: ReadonlySet<string>;
  readonly requirementIds: readonly string[];
  readonly nextId: (seed: string) => string;
}

const gapStatement = (path: RuntimePath, gap: RuntimeGap): string => {
  const caller = path.hops[0]?.name ?? 'the caller';
  const missing = (gap.missingConfig ?? []).join(', ');
  return `The plan configures the nominal service, but traffic from ${caller} reaches it through ${gap.atName}, which does not receive ${missing}. The deployment plan is incomplete.`;
};

/**
 * A gap on a fully-read path is a fact about the repository and can block. A gap on a path with an
 * inferred or unresolved hop warns instead: the chain might not be the one traffic takes, and
 * stopping work on a chain we could not finish reading would be exactly the fabricated certainty
 * this system refuses to produce.
 */
const severityFor = (path: RuntimePath): 'blocking' | 'warning' =>
  path.incompleteReason === undefined && path.hops.every((hop) => hop.inferred !== true)
    ? 'blocking'
    : 'warning';

const unresolvedFinding = (
  path: RuntimePath,
  input: CheckRuntimeInput,
): PreflightFinding | undefined => {
  if (path.incompleteReason === undefined) {
    return undefined;
  }
  const result = createPreflightFinding({
    id: input.nextId(`unresolved:${path.id}`),
    kind: 'runtime-topology-gap',
    severity: 'warning',
    // A chain ImpactGraph could not finish reading is a limit of ITS reach, not a risk this
    // specification introduced — and it is a property of the repository, so it belongs to no
    // requirement. Attributing it to every requirement in the run made one pre-existing
    // unresolved Terraform expression read as a new risk in each of them (ADR-0023).
    origin: 'analysis-caveat',
    verification: 'unverified-assumption',
    requirementIds: [],
    statement: `ImpactGraph could not resolve the runtime path from ${path.hops[0]?.name ?? 'the caller'} to a serving process: ${path.incompleteReason}. This is a limit of the analysis, not a finding against the plan.`,
    recommendation:
      'Confirm by hand which process serves this traffic before relying on the deployment plan.',
    subject: { runtimePathId: path.id, nodeIds: path.hops.map((hop) => hop.nodeId) },
    evidenceIds: path.hops.flatMap((hop) => hop.evidenceIds),
    confidence: 0.5,
    provenance: 'static-analysis',
    analyzer: 'check-runtime',
  });
  return result.ok ? result.value : undefined;
};

/**
 * A process that serves the traffic and is not among the nodes the plan touches is the shape of
 * the original failure — the plan named one thing and production ran another.
 */
const unplannedProcessFinding = (
  path: RuntimePath,
  input: CheckRuntimeInput,
): PreflightFinding | undefined => {
  const serving = processHops(path).at(-1);
  if (serving === undefined || input.planConfiguredNodeIds.size === 0) {
    return undefined;
  }
  if (input.planConfiguredNodeIds.has(serving.nodeId)) {
    return undefined;
  }
  const result = createPreflightFinding({
    id: input.nextId(`unplanned:${path.id}`),
    kind: 'runtime-topology-gap',
    severity: 'warning',
    // A real serving process the plan never mentions IS about the plan — but the plan being
    // silent is not proof it is wrong, so it asks rather than blocks.
    verification: 'unverified-assumption',
    requirementIds: [...input.requirementIds],
    statement: `Production traffic on this path is served by ${serving.name}, which the plan does not mention.`,
    recommendation: `Include ${serving.name} in the plan, or state why it needs no change.`,
    subject: { runtimePathId: path.id, nodeIds: [serving.nodeId] },
    evidenceIds: [...serving.evidenceIds],
    confidence: 0.65,
    provenance: 'static-analysis',
    analyzer: 'check-runtime',
  });
  return result.ok ? result.value : undefined;
};

export const checkRuntime = (input: CheckRuntimeInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  for (const path of input.paths) {
    const gaps = findConfigGaps(path, input.requirements, input.configuredByProcess);
    // One path, one story. A gap already names the process the plan missed and the value it
    // lacks; restating the same path as "unresolved" or "unplanned process" is the same fact in
    // weaker words, and three findings about one path bury the two that decide the verdict.
    if (gaps.length === 0) {
      const unresolved = unresolvedFinding(path, input);
      if (unresolved !== undefined) {
        findings.push(unresolved);
      }
      const unplanned = unplannedProcessFinding(path, input);
      if (unplanned !== undefined) {
        findings.push(unplanned);
      }
    }
    for (const gap of gaps) {
      const result = createPreflightFinding({
        id: input.nextId(`${path.id}:${gap.atNodeId}`),
        kind: 'runtime-topology-gap',
        severity: severityFor(path),
        // A fully-read path that demonstrably lacks the configuration the plan requires is a
        // contradiction. A path with an inferred or unfinished hop is a question about our own
        // reading, and severityFor already keeps it at warning.
        verification:
          severityFor(path) === 'blocking' ? 'verified-contradiction' : 'unverified-assumption',
        requirementIds: [...input.requirementIds],
        statement: gapStatement(path, gap),
        recommendation: `Propagate ${(gap.missingConfig ?? []).join(', ')} to ${gap.atName}, or route this traffic to a process that already has it.`,
        subject: {
          runtimePathId: path.id,
          nodeIds: [gap.atNodeId],
          filePaths: [],
        },
        evidenceIds:
          gap.evidenceIds.length > 0
            ? [...gap.evidenceIds]
            : path.hops.flatMap((hop) => hop.evidenceIds),
        confidence: path.incompleteReason === undefined ? 0.85 : 0.55,
        provenance: 'static-analysis',
        analyzer: 'check-runtime',
      });
      if (result.ok) {
        findings.push(result.value);
      }
    }
  }
  return findings;
};
