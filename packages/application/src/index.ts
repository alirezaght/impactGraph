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
