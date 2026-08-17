import { assignEvidenceProvenance, runPreflight } from '@impactgraph/application';
import { computeReadiness, stableContentId } from '@impactgraph/domain';

import { loadConstraints } from './preflight-guards.js';
import { unmatchedRequirements } from './reports/impact-summary-facts.js';
import { buildRequirementSignals, indexedTypes } from './requirement-signals.js';
import { resolveSuppliedIdentifiers } from './supplied-identifiers.js';

import type {
  AnalogousLiteralMatch,
  ConfigDeclaration,
  PreflightRequirement,
  TestEnvironmentFact,
} from '@impactgraph/application';
import type {
  ConfigRequirement,
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
  /**
   * Correctly-handled SQL literals from the fragment cache (ADR-0020 §4), computed by
   * `analogousSqlLiterals` in the coverage-preflight path. Advisory only: absence degrades a
   * recommendation's pointer, never a finding.
   */
  readonly analogousLiterals?: readonly AnalogousLiteralMatch[];
  /**
   * Configuration the plan needs and how the repository declares it, computed by
   * `configPreflightInputs` in the coverage-preflight path (it reads files and the fragment
   * cache, which this module must not). Absent means the runtime and config-semantics checks run
   * over nothing — degraded, never guessed.
   */
  readonly configRequirements?: readonly ConfigRequirement[];
  readonly configDeclarations?: readonly ConfigDeclaration[];
  /** Test-scoped database declarations, computed by the coverage-preflight path (file access). */
  readonly testEnvironments?: readonly TestEnvironmentFact[];
}

export interface PreflightOutcome {
  readonly findings: readonly PreflightFinding[];
  readonly classifications: readonly RequirementClassification[];
  readonly assessment: PlanAssessment;
  readonly independence: EvidenceIndependence;
  /** The analysis with evidence provenance attached to every impact. */
  readonly analysis: ImpactAnalysis;
  readonly constraintCount: number;
  /** Ids of the constraints that governed this pass — frozen into the preflight artifact (R18). */
  readonly constraintIds: readonly string[];
  readonly opaqueGuardPaths: readonly string[];
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Hop-zero impacts are exactly the concept matches — the components the requirement NAMED. */
const hopZeroNodes = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  requirementId: string,
): readonly { readonly nodeId: string; readonly name: string; readonly path?: string }[] =>
  analysis.requirementImpacts
    .filter((impact) => impact.requirementId === requirementId && impact.dependencyPath.length <= 1)
    .flatMap((impact) => {
      const node = graph.nodes.get(impact.nodeId as NodeId);
      return node === undefined
        ? []
        : [
            {
              nodeId: impact.nodeId,
              name: node.name,
              ...(node.path === undefined ? {} : { path: node.path }),
            },
          ];
    });

/**
 * Resolve one of the requirement's OWN concept strings to a hop-zero node. The ref must stay the
 * specification's wording — endpoint ordering reads the sentence, and node names ("app.py") do not
 * appear in it. A code location beats an infrastructure declaration: when "newsletter service"
 * matches both the Cloud Run resource and the files under services/newsletter-service/, the
 * constraint scope that governs the plan is the code path, not infra/main.tf.
 */
const resolveConceptRef = (
  ref: string,
  nodes: readonly { readonly nodeId: string; readonly name: string; readonly path?: string }[],
): { ref: string; nodeId?: string; path?: string } => {
  const target = normalize(ref);
  const asPrefix = ref.includes('/') ? `${ref.replace(/\/+$/, '')}/` : undefined;
  const hasSegment = (path: string | undefined): boolean =>
    path !== undefined &&
    (asPrefix !== undefined
      ? path === ref || path.startsWith(asPrefix)
      : path
          .split('/')
          .slice(0, -1)
          .some((part) => normalize(part) === target));
  const chosen =
    nodes.find((node) => hasSegment(node.path)) ??
    nodes.find((node) => normalize(node.name) === target) ??
    nodes.find(
      (node) => node.path !== undefined && normalize(node.path.split('/').at(-1) ?? '') === target,
    );
  return chosen === undefined
    ? { ref }
    : { ref, nodeId: chosen.nodeId, ...(chosen.path === undefined ? {} : { path: chosen.path }) };
};

/**
 * The components a requirement named, in the specification's own words, resolved against the
 * hop-zero matches. Requirements extracted before concepts were recorded fall back to node-name
 * refs, so an old artifact still yields proposed relationships.
 */
const namedConcepts = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  requirement: Specification['requirements'][number],
): PreflightRequirement['concepts'] => {
  const nodes = hopZeroNodes(analysis, graph, requirement.id);
  if (requirement.concepts.length > 0) {
    return requirement.concepts.map((ref) => resolveConceptRef(ref, nodes));
  }
  const seen = new Set<string>();
  const fallback: { ref: string; nodeId?: string; path?: string }[] = [];
  for (const node of nodes) {
    if (seen.has(node.name)) {
      continue;
    }
    seen.add(node.name);
    fallback.push({
      ref: node.name,
      nodeId: node.nodeId,
      ...(node.path === undefined ? {} : { path: node.path }),
    });
  }
  return fallback;
};

/** Every requirement, in the shape the analyzers consume, built from state analysis already holds. */
const preflightRequirements = (context: PreflightContext): readonly PreflightRequirement[] => {
  const signalContext = {
    analysis: context.analysis,
    missingRepositoryCount: context.missingRepositoryNames.length,
    indexedNodeTypes: indexedTypes(context.graph),
    // The same resolution the analyze summary's suppliedIdentifiers block reports — one
    // computation, so a signal can never claim a missing file the summary says resolved.
    unresolvedSuppliedIdentifiers: resolveSuppliedIdentifiers(
      context.specificationText,
      context.graph,
    ).unresolvedInKnownScope,
  };
  const withImpact = new Set(
    context.analysis.requirementImpacts.map((impact) => impact.requirementId),
  );
  return context.specification.requirements.map((requirement) => ({
    id: requirement.id,
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
    statement: requirement.statement,
    concepts: namedConcepts(context.analysis, context.graph, requirement),
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
    // The RAW text, because the SQL that motivated ADR-0020 §4 lives in fenced blocks the
    // requirement extractor drops.
    specificationText: context.specificationText,
    ...(context.analogousLiterals === undefined
      ? {}
      : { analogousLiterals: context.analogousLiterals }),
    constraints: loaded.constraints,
    ...(context.testEnvironments === undefined
      ? {}
      : { testEnvironments: context.testEnvironments }),
    configRequirements: context.configRequirements ?? [],
    configDeclarations: context.configDeclarations ?? [],
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
    constraintIds: loaded.constraints.map((constraint) => constraint.id),
    opaqueGuardPaths: loaded.opaqueGuardPaths,
  };
};
