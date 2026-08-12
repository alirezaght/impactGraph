import { assignEvidenceProvenance, runPreflight } from '@impactgraph/application';
import { stableContentId } from '@impactgraph/domain';

import { loadConstraints } from './preflight-guards.js';

import type { PreflightRequirement, RequirementSignalInput } from '@impactgraph/application';
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

/** Language that describes creating something rather than changing something. */
const CREATION = /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|support for)\b/i;
/** Language that names a system this repository does not contain. */
const EXTERNAL =
  /\b(third[- ]party|external (?:service|system|api)|vendor|upstream provider|sendgrid|stripe|twilio)\b/i;

/** Node types that indicate a KIND of surface is indexed at all — the NEW_SURFACE evidence. */
const SURFACE_KINDS: readonly { readonly pattern: RegExp; readonly types: readonly string[] }[] = [
  { pattern: /\b(localization|localisation|i18n|translation|locale)\b/i, types: ['locale-bundle', 'translation-key'] },
  { pattern: /\b(route|endpoint|path)\b/i, types: ['api-endpoint', 'controller', 'handler'] },
  { pattern: /\b(schema|contract)\b/i, types: ['json-schema', 'openapi-document', 'schema'] },
  { pattern: /\b(migration)\b/i, types: ['migration'] },
  { pattern: /\b(feature flag)\b/i, types: ['feature-flag'] },
  { pattern: /\b(event|topic|queue)\b/i, types: ['topic', 'pubsub-topic', 'domain-event'] },
];

const indexedTypes = (graph: KnowledgeGraph): ReadonlySet<string> => {
  const types = new Set<string>();
  for (const node of graph.nodes.values()) {
    types.add(node.type);
  }
  return types;
};

const siblingSurfaceIndexed = (statement: string, types: ReadonlySet<string>): boolean =>
  SURFACE_KINDS.some(
    (kind) => kind.pattern.test(statement) && kind.types.some((type) => types.has(type)),
  );

export interface PreflightContext {
  readonly rootDir: string;
  readonly specification: Specification;
  readonly specificationText: string;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
  readonly coverageInsufficient: boolean;
  /** Requirement ids the coverage check flagged as depending on unindexed repositories. */
  readonly coverageAffectedRequirementIds: readonly string[];
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

const signalsFor = (
  statement: string,
  requirementId: string,
  context: PreflightContext,
  types: ReadonlySet<string>,
): RequirementSignalInput => ({
  hasInvalidSymbolAssumption: false,
  touchesUnindexedRepository: context.coverageAffectedRequirementIds.includes(requirementId),
  touchesIndexingGap: false,
  usesCreationLanguage: CREATION.test(statement),
  referencesExternalBoundary: EXTERNAL.test(statement),
  hasAmbiguousConcept: context.analysis.warnings.some(
    (warning) => warning.code === 'ambiguous-concept' && warning.requirementId === requirementId,
  ),
  siblingSurfaceIndexed: siblingSurfaceIndexed(statement, types),
});

export const runPreflightForAnalysis = (context: PreflightContext): PreflightOutcome => {
  const loaded = loadConstraints(
    context.rootDir,
    context.graph,
    context.snapshotId,
    context.analysis.createdAt,
  );
  const types = indexedTypes(context.graph);
  const withImpact = new Set(
    context.analysis.requirementImpacts.map((impact) => impact.requirementId),
  );
  const requirements: readonly PreflightRequirement[] = context.specification.requirements.map(
    (requirement) => ({
      id: requirement.id,
      ...(requirement.label === undefined ? {} : { label: requirement.label }),
      statement: requirement.statement,
      concepts: namedConcepts(context.analysis, context.graph, requirement.id),
      hasStructuralImpact: withImpact.has(requirement.id),
      signals: signalsFor(requirement.statement, requirement.id, context, types),
    }),
  );

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
    ...(context.score === undefined ? {} : { score: context.score }),
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
