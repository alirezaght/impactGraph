import { assignEvidenceProvenance, runPreflight } from '@impactgraph/application';
import { computeReadiness, stableContentId } from '@impactgraph/domain';

import { loadConstraints } from './preflight-guards.js';
import { unmatchedRequirements } from './reports/impact-summary-facts.js';
import { buildRequirementSignals, indexedTypes } from './requirement-signals.js';

import type { PreflightRequirement } from '@impactgraph/application';
import type {
  EvidenceIndependence,
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  PlanAssessment,
  PreflightFinding,
  RequirementClassification,
  Specification,
} from '@impactgraph/domain';

/**
 * The preflight pass, wired into analysis so it always runs (R16).
 *
 * Every signal it feeds the analyzers is read from state the analysis already computed — the graph,
 * the impact model, the coverage verdict — so the pass adds a comparison, not a second opinion.
 */

export interface PreflightContext {
  readonly rootDir: string;
  readonly specification: Specification;
  readonly specificationText: string;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
  readonly coverageInsufficient: boolean;
  /**
   * Registered, enabled repositories absent from the current index — a roster FACT, sourced from
   * the SAME WorkspaceRepositoryContext that builds the coverage DTO (see
   * `unindexedRegisteredRepositories`). Empty on a fully indexed workspace, in which case no
   * classification may claim an unindexed repository.
   */
  readonly missingRepositoryNames: readonly string[];
  /** A caller-supplied readiness score. When absent, computed here unless it must be withheld. */
  readonly score?: number | undefined;
}

export interface PreflightOutcome {
  readonly findings: readonly PreflightFinding[];
  readonly classifications: readonly RequirementClassification[];
  readonly assessment: PlanAssessment;
  readonly independence: EvidenceIndependence;
  /** The analysis with evidence provenance attached to every impact. */
  readonly analysis: ImpactAnalysis;
  readonly constraintCount: number;
  readonly opaqueGuardPaths: readonly string[];
}

/**
 * The components a requirement NAMED, as opposed to everything it reaches: impacts at hop zero are
 * exactly the concept matches, which is what a proposed relationship must be built from.
 */
const namedConcepts = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  requirementId: string,
): PreflightRequirement['concepts'] => {
  const seen = new Set<string>();
  const concepts: { ref: string; nodeId?: string; path?: string }[] = [];
  for (const impact of analysis.requirementImpacts) {
    if (impact.requirementId !== requirementId || impact.dependencyPath.length > 1) {
      continue;
    }
    const node = graph.nodes.get(impact.nodeId as NodeId);
    if (node === undefined || seen.has(node.name)) {
      continue;
    }
    seen.add(node.name);
    concepts.push({
      ref: node.name,
      nodeId: impact.nodeId,
      ...(node.path === undefined ? {} : { path: node.path }),
    });
  }
  return concepts;
};

/** Every requirement, in the shape the analyzers consume, built from state analysis already holds. */
const preflightRequirements = (context: PreflightContext): readonly PreflightRequirement[] => {
  const signalContext = {
    analysis: context.analysis,
    missingRepositoryCount: context.missingRepositoryNames.length,
    indexedNodeTypes: indexedTypes(context.graph),
  };
  const withImpact = new Set(
    context.analysis.requirementImpacts.map((impact) => impact.requirementId),
  );
  return context.specification.requirements.map((requirement) => ({
    id: requirement.id,
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
    statement: requirement.statement,
    concepts: namedConcepts(context.analysis, context.graph, requirement.id),
    hasStructuralImpact: withImpact.has(requirement.id),
    signals: buildRequirementSignals(requirement.statement, requirement.id, signalContext),
  }));
};

/**
 * The deterministic readiness score the assessment carries, withheld under exactly the conditions
 * the report's specification block withholds it (provisional extraction, insufficient coverage) —
 * and when withheld, the assessment states THAT reason, never "no score was supplied".
 */
const scoreFields = (
  context: PreflightContext,
): { readonly score: number } | { readonly scoreWithheldReason: string } => {
  if (context.score !== undefined) {
    return { score: context.score };
  }
  if (context.specification.extractionQuality?.provisional === true) {
    return {
      scoreWithheldReason:
        'The requirement list was cut out of prose by the extractor, so a readiness score would rate invented requirements.',
    };
  }
  if (context.coverageInsufficient) {
    return {
      scoreWithheldReason:
        'Repository coverage is insufficient — a readiness score over a graph that is missing the feature’s repositories would be misleading.',
    };
  }
  return {
    score: computeReadiness(context.specification, {
      unmatchedRequirementIds: unmatchedRequirements(context.specification, context.analysis).map(
        (requirement) => requirement.id,
      ),
    }).score,
  };
};

export const runPreflightForAnalysis = (context: PreflightContext): PreflightOutcome => {
  const loaded = loadConstraints(
    context.rootDir,
    context.graph,
    context.snapshotId,
    context.analysis.createdAt,
  );
  const requirements = preflightRequirements(context);
  const result = runPreflight({
    requirements,
    graph: context.graph,
    constraints: loaded.constraints,
    configRequirements: [],
    configDeclarations: [],
    planConfiguredNodeIds: new Set(
      context.analysis.requirementImpacts.map((impact) => impact.nodeId),
    ),
    blockingQuestions: context.specification.openQuestions.filter(
      (question) => question.status === 'open' && question.severity === 'blocking',
    ).length,
    coverageInsufficient: context.coverageInsufficient,
    ...scoreFields(context),
    nextId: (seed) => stableContentId('finding', seed),
  });

  const constraintDerivedNodeIds = new Set(
    result.findings.flatMap((finding) => finding.subject.nodeIds ?? []),
  );
  const runtimeDerivedNodeIds = new Set(
    result.findings
      .filter((finding) => finding.kind === 'runtime-topology-gap')
      .flatMap((finding) => finding.subject.nodeIds ?? []),
  );
  const provenance = assignEvidenceProvenance({
    analysis: context.analysis,
    graph: context.graph,
    specificationText: context.specificationText,
    constraintDerivedNodeIds,
    runtimeDerivedNodeIds,
  });

  return {
    findings: result.findings,
    classifications: result.classifications,
    assessment: result.assessment,
    independence: provenance.independence,
    analysis: provenance.analysis,
    constraintCount: loaded.constraints.length,
    opaqueGuardPaths: loaded.opaqueGuardPaths,
  };
};
