import {
  categorizeIndexWarnings,
  computeReadiness,
  reconciledScore,
  evidenceTypesOf,
  primaryEvidenceType,
  provenanceLabel,
} from '@impactgraph/domain';

import {
  resolveSuppliedIdentifiers,
  toSuppliedIdentifiersDto,
} from '../supplied-identifiers.js';

import { analysisBlock, decisionBlock } from './decision-block.js';
import { buildEvidenceQuality, evidenceLimitations } from './evidence-quality-block.js';
import {
  DEFAULT_TOP_N,
  groupByNode,
  predictedPathsOf,
  selectImpacts,
} from './impact-selection.js';
import { summaryCounts, unmatchedRequirements, unresolvedConcepts } from './impact-summary-facts.js';
import { toIndexWarningReportDto } from './index-health-dto.js';
import { impactedPaths, predictArtifacts } from './predicted-artifacts.js';
import { buildRequiredActions } from './required-actions.js';
import { buildUnmatchedBlock } from './unmatched-block.js';
import { buildWorkspaceCoverage } from './workspace-coverage-block.js';

import type { GroupedImpact } from './impact-selection.js';
import type { PreflightOutcome } from '../preflight.js';
import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type {
  CliImpactSummary,
  EvidenceQualityDto,
  ImpactFilters,
  WorkspaceCoverageDto,
} from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  IndexFreshness,
  KnowledgeGraph,
  NodeId,
  PlanAssessment,
  RawIndexWarning,
  Specification,
} from '@impactgraph/domain';

// The bounded analyze document (item 9). Shared by `impactgraph analyze` and the MCP
// `analyze_impact` tool — one builder, one contract (ADR-0009).

export interface ImpactSummaryInput {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly freshness: IndexFreshness;
  readonly extractionMode: CliImpactSummary['specification']['extractionMode'];
  readonly indexWarnings: readonly RawIndexWarning[];
  /** Item 10: the scanner's ignored-file count, which has no per-file warning. */
  readonly ignoredFileCount?: number;
  /**
   * The run's TRUE warning count. `indexWarnings` is the persisted, capped sample; without the
   * true count the report's total silently maxes out near the cap while status reports the real
   * number — two tools disagreeing about the same fact.
   */
  readonly totalWarningCount?: number;
  /** Repository roster + discovery state; absent when the caller has no workspace on disk. */
  readonly workspace?: WorkspaceRepositoryContext;
  readonly filters?: ImpactFilters;
  /**
   * ADR-0017 — the preflight pass. Absent means it did not run for this analysis (an older stored
   * artifact, or a caller that has no repository on disk to read guards from); the fields it
   * populates stay absent rather than reporting zero findings, because zero findings is a claim.
   */
  readonly preflight?: PreflightOutcome;
}

/** Warnings a reader must see. Everything else is counted, not printed (item 9). */
const IMPORTANT_WARNING_CODES = new Set([
  'provisional-extraction',
  'non-goal-contradiction',
  'stale-index',
  'coverage-gap',
  'traversal-exhausted',
  'ambiguous-concept',
  'unsupported-claim',
  'invalid-reference',
]);

const WARNING_LIMIT = 10;

const importantWarnings = (
  analysis: ImpactAnalysis,
): { kept: CliImpactSummary['warnings']; omitted: number } => {
  const seen = new Set<string>();
  const kept: CliImpactSummary['warnings'] = [];
  let omitted = 0;
  for (const warning of analysis.warnings) {
    if (!IMPORTANT_WARNING_CODES.has(warning.code)) {
      omitted += 1;
      continue;
    }
    const key = `${warning.code}|${warning.message}`;
    if (seen.has(key)) {
      omitted += 1;
      continue;
    }
    seen.add(key);
    if (kept.length >= WARNING_LIMIT) {
      omitted += 1;
      continue;
    }
    kept.push({ code: warning.code, message: warning.message });
  }
  return { kept, omitted };
};

const impactLine = (
  grouped: GroupedImpact,
  graph: KnowledgeGraph,
  includeFullPaths: boolean,
): CliImpactSummary['topImpacts'][number] => {
  const { impact } = grouped;
  const node = graph.nodes.get(impact.nodeId as NodeId);
  const evidenceTypes = evidenceTypesOf(impact);
  return {
    nodeId: impact.nodeId,
    name: node?.name ?? impact.nodeId,
    ...(node?.path === undefined || !includeFullPaths ? {} : { path: node.path }),
    likelihood: impact.likelihood,
    evidenceType: primaryEvidenceType(evidenceTypes),
    impactType: impact.impactType,
    confidence: impact.confidence,
    hops: Math.max(0, impact.dependencyPath.length - 1),
    requirementIds: [...new Set(grouped.requirementIds)].sort(),
    requirementLabels: [...new Set(grouped.requirementLabels)].sort(),
    reason: impact.explanation,
    ...(impact.tierCappedBy === undefined ? {} : { tierCappedBy: impact.tierCappedBy }),
    // Absent when the stored analysis predates the provenance axis — absence must never read as
    // "independently discovered", so nothing is defaulted here (ADR-0017 §5).
    ...(impact.evidenceProvenance === undefined
      ? {}
      : {
          evidenceProvenance: impact.evidenceProvenance,
          provenanceLabel: provenanceLabel(impact.evidenceProvenance),
        }),
  };
};

/**
 * Readiness is WITHHELD, not lowered, when the requirement list is the extractor's guess (item 1).
 * A number computed over invented requirements looks exactly like a number computed over real ones,
 * and the reader has no way to discount it — so there is no honest number to print.
 */
const specificationBlock = (
  input: ImpactSummaryInput,
  unmatchedIds: readonly string[],
  coverage: WorkspaceCoverageDto,
): CliImpactSummary['specification'] => {
  const quality = input.specification.extractionQuality;
  const provisional = quality?.provisional === true;
  return {
    id: input.specification.id,
    version: input.specification.version,
    title: input.specification.title,
    extractionMode: input.extractionMode,
    ...(quality === undefined
      ? {}
      : { extractionQuality: { ...quality, recognizedSections: [...quality.recognizedSections], warnings: [...quality.warnings] } }),
    ...(provisional
      ? {
          readinessWithheldReason:
            'The requirement list was cut out of prose by the extractor, so a readiness score would rate invented requirements. Add an explicit requirements section and re-submit.',
        }
      : coverage.status === 'insufficient-coverage'
        ? {
            // Withheld for the same reason as provisional extraction: a score computed over a
            // graph missing the feature's repositories looks exactly like a trustworthy one.
            readinessWithheldReason:
              'Repository coverage is insufficient — a readiness score over a graph that is missing the feature’s repositories would be misleading. Follow requiredActions and re-run the analysis.',
          }
        : {
            readiness: consistentReadiness(
              computeReadiness(input.specification, {
                unmatchedRequirementIds: unmatchedIds,
              }),
              input.preflight?.assessment,
            ),
          }),
  };
};

/**
 * The §11 readiness score is question-based and can say "Ready for implementation." while the
 * adversarial pass says BLOCKED — both numbers are honest, but printing the sentence next to the
 * verdict reads as a contradiction. The score stays; the recommendation defers to the verdict
 * whenever the verdict is the stronger claim.
 */
const consistentReadiness = (
  readiness: ReturnType<typeof computeReadiness>,
  assessment: PlanAssessment | undefined,
): ReturnType<typeof computeReadiness> => {
  if (
    assessment === undefined ||
    assessment.feasibility === 'READY' ||
    assessment.feasibility === 'READY_WITH_WARNINGS'
  ) {
    return readiness;
  }
  // ADR-0023: the SCORE is reconciled too, not only the sentence. "Readiness: 100%" printed beside
  // "BLOCKED" is the contradiction the evaluation reported, and deferring in prose while leaving
  // the number alone left the reader to decide which half to believe.
  const reconciled = reconciledScore(readiness.score, assessment.feasibility);
  return {
    ...readiness,
    score: reconciled.score,
    recommendedAction:
      reconciled.scoreCappedReason === undefined
        ? assessment.decision
        : `${assessment.decision} ${reconciled.scoreCappedReason}`,
  };
};

const provisionalReasons = (
  input: ImpactSummaryInput,
  coverage: WorkspaceCoverageDto,
  evidenceQuality: EvidenceQualityDto,
): readonly string[] => {
  const reasons: string[] = [];
  if (input.specification.extractionQuality?.provisional === true) {
    reasons.push(
      'Requirement extraction fell back to prose splitting — the requirements are the extractor’s reading, not the author’s list.',
    );
  }
  if (input.freshness.stale) {
    reasons.push(...input.freshness.reasons);
  }
  reasons.push(...coverage.reasons);
  // A weak evidence verdict makes the result indicative only, the same way insufficient coverage
  // does: the shown impacts are name/meaning matches, not structural findings (item 4).
  if (evidenceQuality.status === 'weak') {
    reasons.push(...evidenceQuality.reasons);
  }
  return reasons;
};

const coverageBlock = (
  input: ImpactSummaryInput,
  unmatchedCount: number,
): CliImpactSummary['coverage'] => {
  const report = categorizeIndexWarnings(
    input.indexWarnings,
    predictedPathsOf(input.analysis, input.graph),
    {
      ...(input.ignoredFileCount === undefined
        ? {}
        : { ignoredFileCount: input.ignoredFileCount }),
      ...(input.totalWarningCount === undefined
        ? {}
        : { totalWarningCount: input.totalWarningCount }),
    },
  );
  return {
    requirementCount: input.specification.requirements.length,
    requirementsWithStructuralImpact: input.specification.requirements.length - unmatchedCount,
    indexWarnings: toIndexWarningReportDto(report),
  };
};

/**
 * The things that BLOCK work, grouped so they cannot get lost among routine warnings: questions the
 * author has not answered, contradictions between a non-goal and the graph, the artifact categories
 * the change will need, and the size of any proposed structure.
 */
const blockersBlock = (
  input: ImpactSummaryInput,
): Pick<
  CliImpactSummary,
  'blockingQuestions' | 'nonGoalContradictions' | 'predictedArtifacts' | 'proposedStructure'
> => {
  const { analysis, graph, specification } = input;
  return {
    blockingQuestions: specification.openQuestions
      .filter((question) => question.status === 'open' && question.severity === 'blocking')
      .map((question) => ({
        id: question.id,
        question: question.question,
        severity: question.severity,
      })),
    nonGoalContradictions: analysis.warnings
      .filter((warning) => warning.code === 'non-goal-contradiction')
      .map((warning) => warning.message),
    predictedArtifacts: predictArtifacts(
      specification,
      analysis,
      graph,
      impactedPaths(analysis, graph),
    ).map((prediction) => ({ ...prediction, examplePaths: [...prediction.examplePaths] })),
    ...(analysis.proposedStructure === undefined
      ? {}
      : {
          proposedStructure: {
            nodeCount: analysis.proposedStructure.nodes.length,
            relationshipCount: analysis.proposedStructure.relationships.length,
          },
        }),
  };
};

const FOLLOW_UP: readonly string[] = [
  'list_impacts — every impact, paginated, with dependency paths and confidence signals',
  'explain_node / explain_edge — provenance, evidence and relationships of one component',
  'get_impact_analysis — the full stored artifact, including any proposed structure',
  'export_graph_html — the reviewable diagram and tables',
];

const paginationBlock = (
  grouped: readonly GroupedImpact[],
  selection: ReturnType<typeof selectImpacts>,
): CliImpactSummary['pagination'] => ({
  returned: grouped.length,
  totalMatching: selection.totalMatching,
  ...(selection.nextCursor === undefined ? {} : { nextCursor: selection.nextCursor }),
  appliedFilters: selection.appliedFilters,
});

/** Item 6: the repository dimension — computed only when a workspace roster is in hand. */
const repositoryAttributionOf = (
  input: ImpactSummaryInput,
): Parameters<typeof summaryCounts>[1] =>
  input.workspace === undefined
    ? undefined
    : { graph: input.graph, repositories: input.workspace.repositories };

/** Present only when the pass ran, so absence never reads as "checked, found nothing". */
export const buildImpactSummary = (input: ImpactSummaryInput): CliImpactSummary => {
  const { analysis, graph, specification } = input;
  const selection = selectImpacts(analysis, input.filters);
  const grouped = groupByNode(selection.impacts, specification);
  const unmatched = unmatchedRequirements(specification, analysis);
  const workspaceCoverage = buildWorkspaceCoverage({
    specification,
    analysis,
    context: input.workspace,
    graph,
  });
  const evidenceQuality = buildEvidenceQuality(grouped);
  const reasons = provisionalReasons(input, workspaceCoverage, evidenceQuality);
  const warnings = importantWarnings(analysis);
  const includeFullPaths = input.filters?.includeFullPaths ?? true;
  const topImpacts = grouped.map((entry) => impactLine(entry, graph, includeFullPaths));
  const unresolved = unresolvedConcepts(analysis);
  return {
    // ADR-0022 — decision first: the verdict and its one-sentence reading precede the evidence.
    ...decisionBlock(input, {
      topImpacts,
      unmatchedCount: unmatched.length,
      unresolvedCount: unresolved.length,
    }),
    schemaVersion: 1,
    command: 'analyze',
    analysis: analysisBlock(analysis, reasons),
    specification: specificationBlock(
      input,
      unmatched.map((requirement) => requirement.id),
      workspaceCoverage,
    ),
    freshness: { ...input.freshness, reasons: [...input.freshness.reasons] },
    coverage: coverageBlock(input, unmatched.length),
    counts: summaryCounts(analysis, repositoryAttributionOf(input)),
    evidenceQuality,
    topImpacts,
    ...buildUnmatchedBlock(unmatched, input.preflight?.classifications ?? []),
    unresolvedConcepts: unresolved,
    // The specification's path-shaped identifiers, resolved against the graph — always computable,
    // so a reader can see "the spec names files that do not exist" even without the preflight pass.
    suppliedIdentifiers: toSuppliedIdentifiersDto(
      resolveSuppliedIdentifiers(specification.rawText, graph),
    ),
    ...blockersBlock(input),
    warnings: warnings.kept,
    omittedWarningCount: warnings.omitted,
    pagination: paginationBlock(grouped, selection),
    impactQuery: impactQueryOutcome(input, selection.totalMatching),
    workspaceCoverage,
    requiredActions: buildRequiredActions({
      coverage: workspaceCoverage,
      freshness: input.freshness,
      context: input.workspace,
      evidenceQuality,
    }),
    followUp: [...FOLLOW_UP],
  };
};

/**
 * What this view did NOT cover. The half that stops an empty or short result being over-read.
 * The hidden-tier strings are conditional and count-bearing (item 4): "N lexical-only matches
 * were excluded" only when N > 0 — an exclusion notice for nothing is noise, not honesty.
 */
const limitationsOf = (input: ImpactSummaryInput): readonly string[] => [
  ...(input.workspace?.limitations ?? []),
  ...(input.freshness.stale
    ? ['The index is not current, so components changed since indexing were not considered.']
    : []),
  ...evidenceLimitations(input.analysis, input.filters),
];

const impactQueryOutcome = (
  input: ImpactSummaryInput,
  matching: number,
): CliImpactSummary['impactQuery'] => {
  const limitations = [...limitationsOf(input)];
  const withheld = matching - Math.min(matching, input.filters?.topN ?? DEFAULT_TOP_N);
  return {
    status: matching === 0 ? 'completed-empty' : withheld > 0 ? 'partial' : 'completed',
    scope: `the indexed knowledge graph of this workspace at snapshot ${input.analysis.repositorySnapshotId} (${String(input.graph.nodes.size)} components, ${String(input.graph.edges.size)} relationships)`,
    limitations,
    resultCount: matching,
    ...(withheld > 0
      ? { reason: `${String(withheld)} further matching impact(s) withheld by topN — page with the cursor or raise topN` }
      : {}),
  };
};
