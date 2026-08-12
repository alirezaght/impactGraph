// @impactgraph/application — use cases and ports. Depends only on @impactgraph/domain.

export type { ClockPort, IdentifierPort } from './ports/clock.js';
export type {
  CancellationToken,
  OperationCancelled,
  IndexPhase,
  IndexProgress,
  ProgressReporter,
} from './ports/cancellation.js';
export { NEVER_CANCELLED, operationCancelled } from './ports/cancellation.js';
export type {
  StorageErrorCode,
  StorageError,
  FileHash,
  FragmentCacheEntry,
  GraphIndexUpdate,
  StoredGraph,
  IndexRunRecord,
  IndexStorePort,
} from './ports/index-store.js';
export { storageError } from './ports/index-store.js';
export type {
  GitErrorCode,
  GitError,
  GitRepositoryStatus,
  ChangeType,
  ChangedPath,
  GitDiffResult,
  GitPort,
} from './ports/git.js';
export { gitError } from './ports/git.js';

export type {
  ModelRequest,
  ModelResponse,
  ModelProviderErrorCode,
  ModelProviderError,
  StructuredOutputSchema,
  ModelProviderPort,
} from './ports/model-provider.js';
export { modelProviderError } from './ports/model-provider.js';
export type { SpecificationStorePort } from './ports/specification-store.js';

export type {
  ExtractedRequirementDraft,
  ExtractedQuestionDraft,
  SpecificationExtraction,
  SpecificationExtractionPort,
} from './analyze-specification/extraction-types.js';
export { fallbackExtraction } from './analyze-specification/fallback-extractor.js';
export { isViableConcept } from './analyze-specification/statement-analysis.js';
export type {
  ExtractSpecificationRequest,
  ExtractSpecificationDeps,
  ExtractSpecificationOutcome,
} from './analyze-specification/extract-specification.js';
export { extractSpecification } from './analyze-specification/extract-specification.js';

export type {
  MatchMechanism,
  ConceptMatch,
  ConceptMatchResult,
} from './build-impact-model/concept-matching.js';
export { matchConcepts } from './build-impact-model/concept-matching.js';
export type {
  ImpactCandidate,
  TraversalOptions as ImpactTraversalOptions,
  TraversalResult,
} from './build-impact-model/candidate-traversal.js';
export { traverseCandidates } from './build-impact-model/candidate-traversal.js';
export {
  classifyCandidate,
  impactTypeFor,
  signalsFor,
} from './build-impact-model/classification.js';
export type { BuildImpactModelRequest } from './build-impact-model/build-impact-model.js';
export {
  buildImpactModel,
  validateImpactReferences,
} from './build-impact-model/build-impact-model.js';
export type { ImpactAnalysisStorePort } from './ports/impact-analysis-store.js';
export type { ClarificationStorePort } from './ports/clarification-store.js';
export type {
  ClassificationCandidate,
  ClassificationRequest,
  ImpactClassification,
  ImpactClassificationPort,
} from './build-impact-model/classification-port.js';
export type { RefineOutcome } from './build-impact-model/refine-with-classifier.js';
export type { CompareImplementationRequest } from './review-implementation/compare-implementation.js';
export { compareImplementation } from './review-implementation/compare-implementation.js';
export { estimateCoverage } from './review-implementation/coverage.js';
export {
  classifyDrift,
  DRIFT_CATEGORIES,
  DRIFT_ENTRY_LIMIT,
} from './review-implementation/classify-drift.js';
export type {
  ClassifyDriftRequest,
  DriftCategory,
  DriftClassification,
  DriftEndpoint,
  DriftEntry,
} from './review-implementation/classify-drift.js';
export { buildImplementationContext } from './export-context/build-implementation-context.js';
export type { BuildImplementationContextRequest } from './export-context/build-implementation-context.js';
export type {
  ImpactSummaryExport,
  ExpectationExport,
  ReviewCriterionExport,
  RepositorySnapshotSummaryExport,
  ImplementationContext,
} from './export-context/types.js';
export { matchesGlob, matchesAnyGlob } from './evaluate-rules/glob.js';
export { assignmentFor, staleAssignments } from './evaluate-rules/assignments.js';
export type { PathAssignment } from './evaluate-rules/assignments.js';
export { evaluateDependencyRules, evaluateChangeRules } from './evaluate-rules/evaluate-rules.js';
export type { DependencyRuleRequest } from './evaluate-rules/evaluate-rules.js';
export type {
  ArchitectureContext,
  ComponentAssignment,
  ArchitectureModel,
  DependencyDirectionRule,
  AccompanyingChangeRule,
  ArchitectureRule,
  RuleViolation,
} from './evaluate-rules/types.js';
export { refineWithClassifier } from './build-impact-model/refine-with-classifier.js';
export { clarifySpecification } from './clarify-specification/clarify-specification.js';
export type {
  ClarifySpecificationRequest,
  ClarifyOutcome,
} from './clarify-specification/clarify-specification.js';
export {
  interpretationFootprint,
  compareFootprints,
} from './clarify-specification/interpretation-compare.js';
export { deriveProposedRelationships } from './clarify-specification/proposed-relationships.js';
export type { ProposedRelationshipOutcome } from './clarify-specification/proposed-relationships.js';
export { gateProposedStructure } from './build-impact-model/proposed-structure-gate.js';
export type { ProposedStructureGateResult } from './build-impact-model/proposed-structure-gate.js';
export type {
  InterpretationDraft,
  SpecificationInterpretationPort,
} from './clarify-specification/interpretation-port.js';
export { buildCoChangeIndex } from './history/co-change-index.js';
export type { CoChangeIndex } from './history/co-change-index.js';

// ADR-0017 — constraint extraction, runtime topology and the adversarial preflight pass.
export type {
  GuardFile,
  ExtractedConstraint,
  ConstraintRecognizer,
} from './extract-constraints/types.js';
export { looksLikeGuardPath, GUARD_PATH_PATTERNS } from './extract-constraints/types.js';
export type {
  ExtractConstraintsRequest,
  ExtractConstraintsResult,
} from './extract-constraints/extract-constraints.js';
export {
  extractConstraints,
  DEFAULT_RECOGNIZERS,
} from './extract-constraints/extract-constraints.js';
export type { DeclaredConstraintEntry } from './extract-constraints/recognizers/declared-manifest.js';
export {
  fromDeclaredEntries,
  CONSTRAINTS_MANIFEST_PATH,
} from './extract-constraints/recognizers/declared-manifest.js';
export { unenforcedGuards } from './extract-constraints/recognizers/ci-workflow.js';

export type { ResolveRuntimePathsInput } from './build-runtime-topology/resolve-runtime-paths.js';
export {
  resolveRuntimePaths,
  configuredNamesByProcess,
} from './build-runtime-topology/resolve-runtime-paths.js';

export type {
  ProposedMechanism,
  ProposedEndpoint,
  ProposedEdge,
  ResolvedConcept,
  DeriveProposedEdgesInput,
} from './preflight/proposed-edges.js';
export { deriveProposedEdges, PROPOSED_MECHANISMS } from './preflight/proposed-edges.js';
export type { CheckConstraintsInput } from './preflight/check-constraints.js';
export { checkConstraints } from './preflight/check-constraints.js';
export type { CheckRuntimeInput } from './preflight/check-runtime.js';
export { checkRuntime } from './preflight/check-runtime.js';
export type { AssumptionCheckInput } from './preflight/check-assumptions.js';
export { checkAssumptions } from './preflight/check-assumptions.js';
export type {
  ConfigSemantic,
  ConfigDeclaration,
  CheckConfigSemanticsInput,
} from './preflight/check-config-semantics.js';
export {
  CONFIG_SEMANTICS,
  classifyConfig,
  checkConfigSemantics,
} from './preflight/check-config-semantics.js';
export type {
  RequirementSignalInput,
  ClassifyRequirementsInput,
} from './preflight/classify-requirements.js';
export { classifyRequirements } from './preflight/classify-requirements.js';
export type {
  PreflightRequirement,
  RunPreflightInput,
  PreflightResult,
} from './preflight/run-preflight.js';
export { runPreflight } from './preflight/run-preflight.js';
