export { engineFailure, failWith } from './failure.js';
export type { EngineFailure, Failable } from './failure.js';
export { captureSnapshot, snapshotSummary, GIT_FAILURES } from './snapshot.js';
export { performIndexRun, indexWarnings } from './indexing.js';
export type { IndexRunOutcome, IndexRunResult } from './indexing.js';
export type { IndexSummary } from '@impactgraph/repository-intelligence';
export {
  loadApprovedAnalysis,
  loadAnalysis,
  loadReviewBaseline,
  latestAnalysis,
  listAnalyses,
} from './analyses.js';
export type {
  AnalysisListing,
  BaselineAuthority,
  ReviewBaseline,
  ReviewBaselineOptions,
} from './analyses.js';
export { loadGraphAt, loadGraphForSnapshot, loadCurrentGraph, withIndexStore } from './graphs.js';
export type { CurrentGraph } from './graphs.js';
export {
  initializeWorkspace,
  requireInitialized,
  collectWorkspaceStatus,
  readLastRunWarnings,
} from './workspace.js';
export type { WorkspaceScaffoldOutcome, WorkspaceStatus } from './workspace.js';
export {
  specIdFor,
  titleFor,
  submitSpecification,
  loadSpecification,
  buildAnalysisForSpecification,
  evidenceFilesFor,
} from './specifications.js';
export type {
  ExtractionMode,
  SubmitSpecificationRequest,
  SubmittedSpecification,
  AnalysisBundle,
  BuildAnalysisOptions,
} from './specifications.js';
export { approveAnalysis, recordImpactDecision } from './decisions.js';
export type { ImpactDecisionRequest } from './decisions.js';
export { selectArchitecturalOption } from './option-selection.js';
export type { SelectOptionRequest, SelectOptionOutcome } from './option-selection.js';
export {
  saveReviewArtifact,
  persistReviewDocument,
  loadReviewArtifact,
  reviewArtifactsDir,
} from './review-artifacts.js';
export { acceptDeviation } from './deviations.js';
export type { AcceptDeviationRequest, AcceptDeviationOutcome } from './deviations.js';
export { loadProjectKnowledge, evaluateConfiguredRules } from './rules.js';
export { runReviewPipeline } from './review.js';
export type { ReviewBundle } from './review.js';
export { buildExportBundle } from './export.js';
export type { ExportBundle } from './export.js';
export { findComponents, explainNode, explainEdge } from './queries.js';
export {
  findReferences,
  findReferencesInStore,
  REFERENCE_KNOWN_LIMITS,
} from './symbol-references.js';
export type {
  FindReferencesRequest,
  FindReferencesResult,
  NameMatchedCallSite,
  ReferenceCoverage,
  ReferenceCounterpart,
  ReferenceGroup,
  ReferenceKind,
  ReferencedNode,
} from './symbol-references.js';
export { searchLiterals, searchLiteralsInStore } from './literal-search.js';
export type { LiteralMatch, LiteralSearchRequest, LiteralSearchResult } from './literal-search.js';
export { loadFragmentFacts } from './fragment-facts.js';
export type { FragmentFacts } from './fragment-facts.js';
export type {
  ComponentHit,
  KnowledgeExplanation,
  NodeExplanation,
  EdgeExplanation,
} from './queries.js';
export { summarizeArchitecture } from './architecture-summary.js';
export type { ArchitectureSummary, RejectedEdgeSummary } from './architecture-summary.js';
export {
  resolveOverlay,
  applicationsForGraph,
  contextsForGraph,
  overlayFor,
  readOverlayConfig,
  componentOf,
  relationshipOf,
  precedenceRank,
} from './overlay.js';
export type {
  EffectiveView,
  EffectiveComponent,
  EffectiveMarker,
  EffectiveRelationship,
  CorrectionSummary,
  PrecedenceLevel,
  Resolved,
} from './overlay.js';
export { levelForProvenance, levelForSource, provenanceForLevel } from './overlay-precedence.js';
export { nextArchitectureWithCorrection, isComponentCorrection } from './config-corrections.js';
export {
  createWorkspaceExtractor,
  createWorkspaceAiServices,
  auditLogPath,
} from './model-provider.js';
export type { WorkspaceAiServices } from './model-provider.js';
export type { WorkspaceExtractorOptions } from './model-provider.js';
export { buildAnalyzeOutput } from './reports/analyze-output.js';
export { searchComponents } from './component-search.js';
export type { ComponentSearchOptions } from './component-search.js';
export type {
  ComponentSearchHit,
  ComponentSearchResult,
  MatchKind,
} from './component-search-scoring.js';
export { MATCH_KINDS, scoreNode, candidatesFor, stem } from './component-search-scoring.js';
export { buildImpactSummary } from './reports/impact-summary.js';
export type { ImpactSummaryInput } from './reports/impact-summary.js';
export { buildImpactPage } from './reports/impact-page.js';
export type { ImpactPageInput } from './reports/impact-page.js';
export {
  selectImpacts,
  groupByNode,
  predictedPathsOf,
  DEFAULT_TOP_N,
} from './reports/impact-selection.js';
export { predictArtifacts } from './reports/predicted-artifacts.js';
export {
  assessWorkspaceFreshness,
  lastRunIgnoredCount,
  lastRunWarningInputs,
  lastRunWarningRecords,
  parseWarningLine,
} from './freshness.js';
export type { LastRunWarningInputs } from './freshness.js';
export type { AnalyzeOutputInput } from './reports/analyze-output.js';
export { buildReviewOutput, applyAcceptedDeviations } from './reports/review-output.js';
export type { ReviewBreakdownContext } from './reports/review-output.js';
export { buildReviewBreakdown } from './reports/review-breakdown.js';
export { deriveReviewConfidence, deriveScopeLimitations } from './reports/review-scope.js';
export type { ReviewRepositoryScope } from './reports/review-scope.js';
export { buildReviewMarkdown, reviewSummaryLine } from './reports/review-markdown.js';
export { buildExportOutput } from './reports/export-output.js';
export {
  ARCHITECTURE_NODE_TYPES,
  GRAPH_EDGE_STATUSES,
  GRAPH_GROUPINGS,
  GRAPH_VIEW_KINDS,
  MAX_VISIBLE_EDGES,
  MAX_VISIBLE_NODES,
  RENDER_CATEGORIES,
  UNGROUPED_LABEL,
  isGraphGrouping,
} from './reports/graph-view-model.js';
export type {
  GraphEdgeStatus,
  GraphGrouping,
  GraphView,
  GraphViewEdge,
  GraphViewGroup,
  GraphViewKind,
  GraphViewNode,
  RenderCategory,
} from './reports/graph-view-model.js';
export { buildGraphView } from './reports/graph-view.js';
export type { GraphViewInput } from './reports/graph-view.js';
export { loadGraphView, groupingForGraph } from './reports/graph-view-source.js';
export { renderGraphHtml } from './reports/graph-html.js';
export {
  DEFAULT_GRAPH_FILENAME,
  DEFAULT_IMPACT_FILENAME,
  exportGraphHtmlFile,
  resolveGraphOutPath,
} from './reports/graph-file.js';
export type { GraphExportRequest, GraphExportResult } from './reports/graph-file.js';
export { buildGraphOutput } from './reports/graph-output.js';
export { CATEGORY_STYLES, styleFor } from './reports/graph-style.js';
// --- the impact view source (PRD §18.4/§18.5) ---------------------------------------------------
export { buildImpactView } from './reports/graph-impact-view.js';
export type { ImpactViewInput } from './reports/graph-impact-view.js';
export { loadImpactView } from './reports/graph-impact-source.js';
export type { ImpactViewRequest } from './reports/graph-impact-source.js';
export type { ComponentFacts } from './reports/graph-impact-cells.js';
export { PROPOSED_GROUP_LABEL, UNASSIGNED_GROUP_LABELS } from './reports/graph-impact-model.js';
export type {
  ImpactNodeFacts,
  ImpactRow,
  ImpactTotals,
  ImpactViewFacts,
} from './reports/graph-impact-model.js';
export {
  LIKELIHOOD_SEGMENTS,
  LIKELIHOOD_STYLES,
  PROPOSED_BADGE,
  PROPOSED_DASH,
  likelihoodStyleFor,
  likelihoodText,
} from './reports/graph-impact-style.js';
export type { CategoryStyle } from './reports/graph-style.js';
export { answerQuestion, listClarifications } from './clarifications.js';
export type { AnswerQuestionRequest, AnswerQuestionOutcome } from './clarifications.js';
export {
  confirmRequirement,
  rejectRequirement,
  editRequirement,
  dismissQuestion,
} from './spec-mutations.js';
export type {
  RequirementMutationRequest,
  EditRequirementRequest,
  DismissQuestionRequest,
} from './spec-mutations.js';
export {
  applyConfigOperation,
  previewOperation,
  classifyOperation,
  configHistory,
} from './config-operations.js';
export type {
  ApplyOperationRequest,
  ConfigActor,
  ChangeClassification,
} from './config-operations.js';
export { rollbackConfigChange } from './config-rollback.js';
export type { RollbackRequest } from './config-rollback.js';
export { configAuditPath } from './config-audit.js';
export { detectConfigDrift } from './config-drift.js';
export type { DriftItem, DriftReport } from './config-drift.js';
export { applyInstruction } from './config-instruction.js';
export type {
  InstructionRequest,
  InstructionOutcome,
  InstructionOperationResult,
} from './config-instruction.js';
export { detectStack, generateConfiguration } from './config-generation.js';
export type { StackDetection, GenerationOutcome } from './config-generation.js';
export {
  appendLearningProposal,
  listLearningProposals,
  reviewCoChangeProposal,
  historicalCoChangeProposal,
  coChangeStats,
  learningProposalsPath,
} from './learning.js';
export type { CoChangeStats } from './learning.js';
export { configDiff, restoreConfigVersion, documentDiff } from './config-versions.js';
export type { ConfigDiffResult, DiffLine } from './config-versions.js';
export { summarizeRepositoryStructure } from './structure.js';
export type { PackageStructure, RepositoryStructure } from './structure.js';
export { loadDocuments as readConfigurationDocuments } from './config-changes.js';
export type { Documents as ConfigurationDocuments } from './config-changes.js';
export { validateConfiguration } from './config-validation.js';
export type {
  ConfigFileName,
  ConfigFileValidation,
  ConfigValidationReport,
} from './config-validation.js';
export { explainConfiguration } from './config-explain.js';
export type { ConfigExplanation } from './config-explain.js';
export { readConfirmations, isConfirmed } from './config-confirmations.js';
export {
  refreshConfiguration,
  confirmConfigurationValue,
  removeStaleConfiguration,
} from './config-maintenance.js';
export type {
  RefreshOutcome,
  ConfirmValueRequest,
  ConfirmValueOutcome,
  RemoveStaleOutcome,
} from './config-maintenance.js';
export { testDetectionRule } from './detection-testing.js';
export type { DetectionRuleTestRequest, DetectionRuleTestResult } from './detection-testing.js';

// Item 12: record what an implementation actually touched, and measure the prediction against it.
export { recordActualImpact, listActualImpacts } from './outcomes.js';
export type { RecordActualImpactRequest, RecordActualImpactOutcome } from './outcomes.js';

// Item 7: field-level flow queries and the transformations acting on a value.
export { queryFieldFlow } from './field-flow.js';
export type { FieldFlowResult, FlowHop } from './field-flow.js';
export {
  TRANSFORMATION_KINDS,
  detectTransformations,
  transformationsForPaths,
} from './field-transformations.js';
export type { DetectedTransformation, TransformationKind } from './field-transformations.js';

// Item 6: related repositories registered as one workspace, with separate identities.
export { readRepositoryRoster, indexableRoots } from './registered-repositories.js';
export type { RegisteredRepository, RepositoryRoster } from './registered-repositories.js';
export { discoverCandidateRepositories } from './repository-discovery.js';
export {
  collectWorkspaceRepositoryContext,
  ensureRegisteredRepositoriesIndexed,
  memberPrefix,
} from './repository-coverage.js';
export type { EnsureIndexedOutcome, WorkspaceRepositoryContext } from './repository-coverage.js';

// ADR-0017 — the adversarial preflight pass and the constraint layer it reads.
export type { PreflightContext, PreflightOutcome } from './preflight.js';
export { runPreflightForAnalysis } from './preflight.js';
export type { CoveragePreflightContext } from './coverage-preflight.js';
export { runCoveragePreflight } from './coverage-preflight.js';
export type { SuppliedIdentifierResolution } from './supplied-identifiers.js';
export {
  resolveSuppliedIdentifiers,
  toSuppliedIdentifiersDto,
  UNRESOLVED_IDENTIFIER_LIMIT,
} from './supplied-identifiers.js';
export type { LoadedConstraints } from './preflight-guards.js';
export { collectGuardFiles, loadConstraints } from './preflight-guards.js';
export {
  buildWorkspaceCoverage,
  unindexedRegisteredRepositories,
} from './reports/workspace-coverage-block.js';
export {
  SUMMARY_FINDING_LIMIT,
  toFindingDto,
  toAssessmentDto,
  toClassificationDtos,
  toIndependenceDto,
  summaryFindings,
  toConstraintSummary,
} from './reports/preflight-block.js';
export type { SummarisedWarnings } from './reports/index-warning-summary.js';
export { WARNING_SAMPLE_SIZE, summariseIndexWarnings } from './reports/index-warning-summary.js';
export type { PlanContractInput } from './review-plan-contract.js';
export { reviewAgainstPlan } from './review-plan-contract.js';

// ADR-0017 — runtime traversal re-exported so shells depend on one façade, not two.
export { resolveRuntimePaths, configuredNamesByProcess } from '@impactgraph/application';
