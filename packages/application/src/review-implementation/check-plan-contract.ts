import { createPreflightFinding, isExempt } from '@impactgraph/domain';

import { matchesAnyGlob } from '../evaluate-rules/glob.js';

import type {
  KnowledgeGraph,
  NodeId,
  PreflightFinding,
  RepositoryConstraint,
} from '@impactgraph/domain';

/**
 * The approved plan as a contract, checked against what was actually built.
 *
 * The pre-implementation half already states what should change, which rules govern it, and which
 * runtime processes are on the path. After implementation those are no longer predictions — they
 * are claims the diff either honours or contradicts.
 *
 * This is deliberately not "did the code turn out well". It answers one question: did the
 * implementation match the approved design, and did it introduce anything the design did not
 * account for.
 */

/** What the approved analysis committed to, reduced to what a diff can be checked against. */
export interface ApprovedPlan {
  /** Node ids the plan expected to change. */
  readonly expectedNodeIds: ReadonlySet<string>;
  /** File paths the plan expected to change. */
  readonly expectedPaths: ReadonlySet<string>;
  /** Constraints that governed the plan at approval time. */
  readonly constraints: readonly RepositoryConstraint[];
  /** Runtime processes the plan said were on the request path. */
  readonly runtimeProcessNodeIds: ReadonlySet<string>;
  /** Configuration names the plan said had to propagate. */
  readonly requiredConfigNames: readonly string[];
}

export interface ActualChange {
  readonly changedPaths: readonly string[];
  /** Node ids the diff touched, resolved against the post-implementation graph. */
  readonly changedNodeIds: ReadonlySet<string>;
  /** Relationships the diff ADDED, as `sourceId -TYPE-> targetId`. */
  readonly addedEdges: readonly {
    readonly type: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly graph: KnowledgeGraph;
}

export interface CheckPlanContractInput {
  readonly plan: ApprovedPlan;
  readonly actual: ActualChange;
  readonly nextId: (seed: string) => string;
}

const pathOf = (graph: KnowledgeGraph, nodeId: string): string | undefined =>
  graph.nodes.get(nodeId as NodeId)?.path;

/** Edge types that represent a dependency or a call a constraint can govern. */
const GOVERNABLE_EDGES = new Set([
  'IMPORTS',
  'CALLS',
  'CALLS_ENDPOINT',
  'DEPENDS_ON',
  'USES',
  'INJECTS',
  'PUBLISHES',
  'READS_FROM',
  'WRITES_TO',
]);

/**
 * A relationship the implementation added that a governing constraint forbids.
 *
 * This is the post-implementation half of the pre-implementation check, and it exists because a
 * plan can be approved clean and the implementation can still introduce the forbidden edge — which
 * is precisely how the original failure reached CI.
 */
/** True when this constraint forbids relationships out of this path, with no exemption for it. */
const governsAndForbids = (constraint: RepositoryConstraint, sourcePath: string): boolean =>
  (constraint.kind === 'forbidden-dependency' || constraint.kind === 'forbidden-runtime-call') &&
  matchesAnyGlob(sourcePath, constraint.scope.pathGlobs) &&
  !isExempt(constraint, sourcePath);

const forbiddenFinding = (
  input: CheckPlanContractInput,
  edge: ActualChange['addedEdges'][number],
  constraint: RepositoryConstraint,
  sourcePath: string,
): PreflightFinding | undefined => {
  const targetName = input.actual.graph.nodes.get(edge.targetId as NodeId)?.name ?? edge.targetId;
  const result = createPreflightFinding({
    id: input.nextId(`drift:${edge.sourceId}:${edge.targetId}:${constraint.id}`),
    kind: 'blocking-constraint-violation',
    severity: constraint.severity === 'blocking' ? 'blocking' : 'warning',
    requirementIds: [],
    statement: `The implementation added ${edge.type} from ${sourcePath} to ${targetName}, which ${constraint.source.filePath} forbids: ${constraint.rule.statement}.`,
    recommendation: `Remove the relationship, or add an explicit exemption to ${constraint.source.filePath} and say why.`,
    subject: {
      constraintId: constraint.id,
      nodeIds: [edge.sourceId, edge.targetId],
      filePaths: [sourcePath, constraint.source.filePath],
    },
    evidenceIds: edge.evidenceIds.length > 0 ? [...edge.evidenceIds] : [...constraint.evidenceIds],
    confidence: 0.85,
    provenance: 'static-analysis',
    analyzer: 'check-plan-contract',
  });
  return result.ok ? result.value : undefined;
};

const forbiddenRelationships = (input: CheckPlanContractInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  for (const edge of input.actual.addedEdges) {
    if (!GOVERNABLE_EDGES.has(edge.type)) {
      continue;
    }
    const sourcePath = pathOf(input.actual.graph, edge.sourceId);
    if (sourcePath === undefined) {
      continue;
    }
    for (const constraint of input.plan.constraints) {
      if (!governsAndForbids(constraint, sourcePath)) {
        continue;
      }
      const finding = forbiddenFinding(input, edge, constraint, sourcePath);
      if (finding !== undefined) {
        findings.push(finding);
      }
    }
  }
  return findings;
};

/**
 * A guard that governs the changed area and was not itself updated.
 *
 * Reported only when the change ADDS surface inside the guard's scope. A guard is not obliged to
 * change every time code it watches changes — that would fire on every commit and be ignored within
 * a week.
 */
const staleGuards = (input: CheckPlanContractInput): readonly PreflightFinding[] => {
  const changed = new Set(input.actual.changedPaths);
  const findings: PreflightFinding[] = [];
  for (const constraint of input.plan.constraints) {
    if (constraint.extraction === 'opaque' || constraint.scope.pathGlobs.includes('**')) {
      continue;
    }
    const governedChanges = input.actual.changedPaths.filter((path) =>
      matchesAnyGlob(path, constraint.scope.pathGlobs),
    );
    if (governedChanges.length === 0 || changed.has(constraint.source.filePath)) {
      continue;
    }
    const result = createPreflightFinding({
      id: input.nextId(`guard:${constraint.id}`),
      kind: 'guard-not-updated',
      severity: 'warning',
      requirementIds: [],
      statement: `${String(governedChanges.length)} changed file(s) fall under ${constraint.source.filePath}, which was not updated. Confirm the rule still describes the intended architecture.`,
      recommendation: `Read ${constraint.source.filePath} against the change, and update its scope or allowlist if the design moved.`,
      subject: { constraintId: constraint.id, filePaths: [constraint.source.filePath] },
      evidenceIds: [...constraint.evidenceIds],
      confidence: 0.5,
      provenance: 'static-analysis',
      analyzer: 'check-plan-contract',
    });
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};

/**
 * Deployment work the plan required and the diff never did.
 *
 * The 503 was exactly this shape after the fact: the plan said configuration had to reach the
 * serving process, and nothing in the change touched it.
 */
const missingDeploymentChanges = (input: CheckPlanContractInput): readonly PreflightFinding[] => {
  if (input.plan.requiredConfigNames.length === 0 || input.plan.runtimeProcessNodeIds.size === 0) {
    return [];
  }
  const touchedAProcess = [...input.plan.runtimeProcessNodeIds].some((nodeId) =>
    input.actual.changedNodeIds.has(nodeId),
  );
  const touchedInfrastructure = input.actual.changedPaths.some((path) =>
    /\.tf$|\.tfvars$|(^|\/)(infra|terraform|deploy|k8s)\//.test(path),
  );
  if (touchedAProcess || touchedInfrastructure) {
    return [];
  }
  const result = createPreflightFinding({
    id: input.nextId('deployment:missing'),
    kind: 'runtime-topology-gap',
    severity: 'warning',
    requirementIds: [],
    statement: `The plan required ${input.plan.requiredConfigNames.join(', ')} to reach the serving process, and the change touches no deployment configuration.`,
    recommendation:
      'Add the deployment change, or record explicitly that the configuration is applied outside this repository.',
    subject: { nodeIds: [...input.plan.runtimeProcessNodeIds] },
    evidenceIds: [],
    confidence: 0.6,
    provenance: 'static-analysis',
    analyzer: 'check-plan-contract',
  });
  return result.ok ? [result.value] : [];
};

export interface PlanContractResult {
  readonly findings: readonly PreflightFinding[];
  /** Changed paths the plan never mentioned — not defects, but unaccounted-for work. */
  readonly unplannedPaths: readonly string[];
  /** Paths the plan expected to change and the diff did not touch. */
  readonly unchangedExpectedPaths: readonly string[];
}

export const checkPlanContract = (input: CheckPlanContractInput): PlanContractResult => {
  const changed = new Set(input.actual.changedPaths);
  return {
    findings: [
      ...forbiddenRelationships(input),
      ...missingDeploymentChanges(input),
      ...staleGuards(input),
    ],
    unplannedPaths: input.actual.changedPaths
      .filter((path) => !input.plan.expectedPaths.has(path))
      .sort(),
    unchangedExpectedPaths: [...input.plan.expectedPaths]
      .filter((path) => !changed.has(path))
      .sort(),
  };
};
