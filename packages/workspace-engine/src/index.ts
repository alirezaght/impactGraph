export { engineFailure, failWith } from './failure.js';
export type { EngineFailure, Failable } from './failure.js';
export { captureSnapshot, snapshotSummary, GIT_FAILURES } from './snapshot.js';
export { performIndexRun, indexWarnings } from './indexing.js';
export type { IndexRunOutcome, IndexRunResult } from './indexing.js';
export type { IndexSummary } from '@impactgraph/repository-intelligence';
export { loadApprovedAnalysis, loadAnalysis, listAnalyses } from './analyses.js';
export type { AnalysisListing } from './analyses.js';
export { loadGraphAt, loadCurrentGraph, withIndexStore } from './graphs.js';
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
export type { AnalyzeOutputInput } from './reports/analyze-output.js';
export { buildReviewOutput, applyAcceptedDeviations } from './reports/review-output.js';
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
