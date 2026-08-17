// @impactgraph/domain — pure, dependency-free domain model (PRD §3, §12; ADR-0002).
// Public entry point; deep imports are lint-forbidden (docs/engineering/dependency-rules.md).

export type { Ok, Err, Result } from './errors/result.js';
export { ok, err } from './errors/result.js';
export type { ValidationIssue, ValidationIssueCode, ValidationError } from './errors/validation.js';
export { validationIssue, validationError } from './errors/validation.js';

export type {
  NodeId,
  EdgeId,
  EvidenceId,
  RepositorySnapshotId,
  AnalysisRunId,
  SpecificationId,
} from './ids.js';

export type { Provenance, KnowledgeCategory } from './provenance/provenance.js';
export { PROVENANCE_VALUES, isProvenance, knowledgeCategoryOf } from './provenance/provenance.js';

export type {
  ConfidenceSignalType,
  ConfidenceSignal,
  ConfidenceScore,
  ConfidenceSignalInput,
  ConfidenceScoreInput,
} from './provenance/confidence.js';
export {
  CONFIDENCE_SIGNAL_TYPES,
  PENALTY_SIGNAL_TYPES,
  createConfidenceScore,
} from './provenance/confidence.js';

export type {
  EvidenceKind,
  SourceRange,
  FileSource,
  ConfigSource,
  GitCommitSource,
  EvidenceSource,
  EvidenceRecord,
  CreateEvidenceRecordInput,
  EvidenceDerivation,
  RouteReference,
} from './provenance/evidence.js';
export { EVIDENCE_KINDS, createEvidenceRecord } from './provenance/evidence.js';

export type {
  SpecificationRef,
  SpecificationRefInput,
  KnowledgeEnvelope,
  KnowledgeEnvelopeInput,
} from './provenance/knowledge-envelope.js';
export { createKnowledgeEnvelope } from './provenance/knowledge-envelope.js';

export type { NodeCategory, NodeType } from './repository/node-types.js';
export {
  NODE_TYPES_BY_CATEGORY,
  NODE_CATEGORIES,
  isNodeCategory,
  isNodeTypeInCategory,
} from './repository/node-types.js';
export type { QueryStatus, QueryOutcome } from './query/query-outcome.js';
export {
  QUERY_STATUSES,
  isQueryStatus,
  queryOutcome,
  queryOutcomeIssues,
  notRunOutcome,
  failedOutcome,
  describeOutcome,
} from './query/query-outcome.js';
export type {
  FreshnessState,
  IndexFreshness,
  FreshnessInput,
} from './repository/index-freshness.js';
export { FRESHNESS_STATES, assessFreshness } from './repository/index-freshness.js';
export type {
  IndexWarningCategory,
  IndexWarningGroup,
  IndexWarningReport,
  RawIndexWarning,
  BulkWarningCounts,
} from './repository/warning-categories.js';
export {
  INDEX_WARNING_CATEGORIES,
  COVERAGE_LOSING_CATEGORIES,
  categorizeWarningMessage,
  categorizeIndexWarnings,
} from './repository/warning-categories.js';
export type { EdgeType } from './repository/edge-types.js';
export { EDGE_TYPES, isEdgeType } from './repository/edge-types.js';

export type {
  GraphNode,
  CreateGraphNodeInput,
  RouteContract,
  RouteParameter,
  Requiredness,
} from './repository/graph-node.js';
export { createGraphNode, routeDisplayName } from './repository/graph-node.js';
export type { GraphEdge, CreateGraphEdgeInput } from './repository/graph-edge.js';
export { createGraphEdge } from './repository/graph-edge.js';

export type {
  BranchHead,
  DetachedHead,
  RepositoryHead,
  RepositoryHeadInput,
  RepositorySnapshot,
  CreateRepositorySnapshotInput,
} from './repository/repository-snapshot.js';
export { createRepositorySnapshot } from './repository/repository-snapshot.js';

export type { KnowledgeGraph } from './repository/knowledge-graph.js';
export { createKnowledgeGraph } from './repository/knowledge-graph.js';
export type {
  NodeFilter,
  TraversalDirection,
  TraversalOptions,
  SubgraphOptions,
  DependencyPath,
} from './repository/graph-queries.js';
export {
  findNodes,
  neighbors,
  findShortestPath,
  extractSubgraph,
} from './repository/graph-queries.js';
export type {
  PathBearing,
  PathResolutionVia,
  ResolvedPathReference,
  AmbiguousPathReference,
  UnresolvedPathReference,
  PathReferenceResolution,
} from './repository/path-resolution.js';
export { normalizePathReference, resolvePathReference } from './repository/path-resolution.js';
export type { MemberResolution, MemberResolutionOptions } from './repository/member-resolution.js';
export { resolveMember } from './repository/member-resolution.js';

export type {
  KnowledgeEnvelopeJson,
  ConfidenceJson,
  ConfidenceSignalJson,
  SpecificationRefJson,
} from './serialization/knowledge-json.js';
export { serializeKnowledgeEnvelope } from './serialization/knowledge-json.js';
export type { GraphNodeJson, GraphEdgeJson } from './serialization/graph-json.js';
export {
  GRAPH_NODE_SCHEMA_VERSION,
  GRAPH_EDGE_SCHEMA_VERSION,
  serializeGraphNode,
  serializeGraphEdge,
  parseGraphNode,
  parseGraphEdge,
} from './serialization/graph-json.js';
export type { EvidenceRecordJson } from './serialization/evidence-json.js';
export {
  EVIDENCE_RECORD_SCHEMA_VERSION,
  serializeEvidenceRecord,
  parseEvidenceRecord,
} from './serialization/evidence-json.js';
export type {
  RequirementType,
  RequirementPriority,
  RequirementStatus,
  RequirementOrigin,
  TextRange,
  Requirement,
} from './specification/requirement.js';
export {
  REQUIREMENT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_ORIGINS,
  STRUCTURED_ORIGINS,
  isStructuredOrigin,
  originOf,
  stableContentId,
  stableRequirementId,
} from './specification/requirement.js';
export type { SpecNote, SpecNoteKind } from './specification/spec-notes.js';
export { SPEC_NOTE_KINDS, nonGoalsOf, specNoteId } from './specification/spec-notes.js';
export type { ExtractionQuality, ExtractionStrategy } from './specification/extraction-quality.js';
export {
  EXTRACTION_STRATEGIES,
  PROSE_PROVISIONAL_THRESHOLD,
  isProvisional,
  strategyFor,
} from './specification/extraction-quality.js';
export type {
  SpecificationSourceType,
  OpenQuestionSeverity,
  OpenQuestionStatus,
  OpenQuestion,
  Actor,
  Constraint,
  ArchitecturalDecision,
  Specification,
  CreateSpecificationInput,
  NextVersionChanges,
} from './specification/specification.js';
export {
  SPECIFICATION_SOURCE_TYPES,
  OPEN_QUESTION_SEVERITIES,
  OPEN_QUESTION_STATUSES,
  createSpecification,
  createNextSpecificationVersion,
} from './specification/specification.js';
export {
  confirmRequirement,
  rejectRequirement,
  editRequirementStatement,
  dismissOpenQuestion,
} from './specification/mutation.js';
export { isAnalysisStale } from './specification/staleness.js';
export type { AnalysisVersionRef } from './specification/staleness.js';
export type { SpecificationDiff, RequirementChange } from './specification/diff.js';
export { diffSpecifications } from './specification/diff.js';
export type { SpecificationJson } from './serialization/specification-json.js';
export {
  SPECIFICATION_SCHEMA_VERSION,
  serializeSpecification,
  parseSpecification,
} from './serialization/specification-json.js';

export type {
  ImpactLikelihood,
  ImpactType,
  ImpactDirectness,
  RequirementImpact,
  AnalysisWarning,
  UserDecisionKind,
  UserImpactDecision,
  ArchitecturalOption,
  OptionImplications,
  AnalysisStatus,
  ImpactAnalysis,
  ImpactAnalysisContext,
  ChangeExpectation,
} from './impact/impact-analysis.js';
export type {
  ProposedEndpointKind,
  ProposedNode,
  ProposedRelationship,
  ProposedStructure,
  ProposedStructureContext,
} from './impact/proposed-structure.js';
export {
  PROPOSED_ENDPOINT_KINDS,
  collectProposedStructureIssues,
} from './impact/proposed-structure.js';
export type { ImpactEvidenceType } from './impact/evidence-basis.js';
export {
  IMPACT_EVIDENCE_TYPES,
  STRUCTURAL_EVIDENCE_TYPES,
  isImpactEvidenceType,
  primaryEvidenceType,
  evidenceStrengthRank,
  likelihoodRank,
  capLikelihood,
} from './impact/evidence-basis.js';
export {
  IMPACT_LIKELIHOODS,
  PREDICTIVE_LIKELIHOODS,
  evidenceTypesOf,
  IMPACT_TYPES,
  IMPACT_DIRECTNESS,
  USER_DECISION_KINDS,
  ANALYSIS_STATUSES,
  createImpactAnalysis,
  approveImpactAnalysis,
  markImpactAnalysisReviewed,
  supersedeImpactAnalysis,
  addUserDecision,
  evidenceProvenanceOf,
  CHANGE_EXPECTATIONS,
  changeExpectationOf,
  expectsNoChange,
} from './impact/impact-analysis.js';

// ADR-0017 — repository constraints, preflight findings, plan assessment, runtime topology.
export type {
  ConstraintKind,
  ConstraintRelation,
  ConstraintSeverity,
  ConstraintExtraction,
} from './constraint/constraint-vocabulary.js';
export {
  CONSTRAINT_KINDS,
  CONSTRAINT_RELATIONS,
  CONSTRAINT_SEVERITIES,
  CONSTRAINT_EXTRACTIONS,
  AUTHORITATIVE_EXTRACTIONS,
  isConstraintKind,
  isConstraintRelation,
  canBlock,
  cappedSeverity,
} from './constraint/constraint-vocabulary.js';
export type {
  ConstraintScope,
  ConstraintRule,
  ConstraintExemption,
  RepositoryConstraint,
} from './constraint/repository-constraint.js';
export { createRepositoryConstraint, isExempt } from './constraint/repository-constraint.js';

export type {
  EvidenceProvenance,
  EvidenceIndependence,
  ProvenanceLabel,
} from './preflight/evidence-provenance.js';
export {
  EVIDENCE_PROVENANCES,
  INDEPENDENT_PROVENANCES,
  isEvidenceProvenance,
  independenceWeight,
  isIndependent,
  provenanceOf,
  provenanceLabel,
  summariseIndependence,
} from './preflight/evidence-provenance.js';
export type {
  PreflightFindingKind,
  FindingSeverity,
  FindingSubject,
  FindingOrigin,
  FindingVerification,
  PreflightFinding,
} from './preflight/preflight-finding.js';
export {
  PREFLIGHT_FINDING_KINDS,
  FINDING_SEVERITIES,
  FINDING_ORIGINS,
  FINDING_VERIFICATIONS,
  isPreflightFindingKind,
  createPreflightFinding,
  isBlocking,
  isPlanFinding,
  findingOriginOf,
  verificationOf,
} from './preflight/preflight-finding.js';
export type {
  UnmatchedRequirementClass,
  ClassificationSignals,
  RequirementClassification,
} from './preflight/requirement-classification.js';
export {
  UNMATCHED_REQUIREMENT_CLASSES,
  isUnmatchedRequirementClass,
  classifyUnmatchedRequirement,
} from './preflight/requirement-classification.js';
export type {
  Feasibility,
  PlanAssessment,
  PlanAssessmentCounts,
  AssessmentInput,
} from './preflight/plan-assessment.js';
export { FEASIBILITIES, assessPlan } from './preflight/plan-assessment.js';

export type {
  RuntimeHopKind,
  RuntimeHop,
  RuntimePath,
  ConfigRequirement,
  RuntimeGapKind,
  RuntimeGap,
} from './runtime/runtime-path.js';
export {
  RUNTIME_HOP_KINDS,
  RUNTIME_GAP_KINDS,
  processHops,
  isFullyResolved,
  findConfigGaps,
} from './runtime/runtime-path.js';
export type { ImpactSignalInput } from './impact/confidence-weights.js';
export {
  IMPACT_SIGNAL_WEIGHTS,
  PROPOSED_RELATIONSHIP_SIGNAL_WEIGHTS,
  computeImpactConfidence,
  computeProposedRelationshipConfidence,
} from './impact/confidence-weights.js';
export type { ImpactAnalysisJson } from './serialization/impact-json.js';
export {
  IMPACT_ANALYSIS_SCHEMA_VERSION,
  serializeImpactAnalysis,
  parseImpactAnalysis,
} from './serialization/impact-json.js';

export type {
  ReviewCategory,
  ReviewFinding,
  CoverageStatus,
  CoverageEvidence,
  RequirementCoverage,
  ReviewTarget,
  EdgeChangeSummary,
  ImplementationReview,
} from './review/implementation-review.js';
export {
  REVIEW_CATEGORIES,
  COVERAGE_STATUSES,
  REVIEW_TARGETS,
  createImplementationReview,
  hasDiscrepancies,
} from './review/implementation-review.js';
export type {
  ReviewVerdict,
  ReviewVerdictCounts,
  ReviewVerdictInput,
  ReviewVerdictStatus,
  DecidingFinding,
} from './review/review-verdict.js';
export { REVIEW_VERDICT_STATUSES, reviewVerdict } from './review/review-verdict.js';

export type { RepositoryHeadJson, RepositorySnapshotJson } from './serialization/snapshot-json.js';
export {
  REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  serializeRepositorySnapshot,
  parseRepositorySnapshot,
} from './serialization/snapshot-json.js';
export { computeReadiness } from './specification/readiness.js';
export type { ReadinessReport } from './specification/readiness.js';
export { assessCoverageSufficiency } from './impact/workspace-coverage.js';
export type {
  CoverageSufficiencyInput,
  WorkspaceCoverageStatus,
  WorkspaceCoverageVerdict,
} from './impact/workspace-coverage.js';
export { assessEvidenceQuality } from './impact/evidence-quality.js';
export type {
  EvidenceQualityContext,
  EvidenceQualityCounts,
  EvidenceQualityStatus,
  EvidenceQualityVerdict,
  ShownImpactFact,
} from './impact/evidence-quality.js';
export {
  createClarificationRecord,
  answerOpenQuestion,
  applyKnownClarifications,
  clarificationQuestionKey,
  CLARIFICATION_AUTHORS,
} from './specification/clarification.js';
export type { ClarificationRecord, ClarificationAuthor } from './specification/clarification.js';
export {
  serializeClarification,
  parseClarification,
  CLARIFICATION_SCHEMA_VERSION,
} from './serialization/clarification-json.js';

// Item 12: recorded outcomes and the accuracy they make measurable. Evidence, never training data —
// append-only, never mutating an analysis, never promoting one result to a rule.
export type {
  ActualImpact,
  ActualChangedSymbol,
  ActualRelationshipChange,
  ManualFinding,
  ArtifactCategory,
  EvaluationMetrics,
} from './evaluation/actual-impact.js';
export { ARTIFACT_CATEGORIES, createActualImpact } from './evaluation/actual-impact.js';
export type { MeasureInput } from './evaluation/measure.js';
export { DEFAULT_JUDGED_TIERS, measureAnalysis } from './evaluation/measure.js';
// Item 8: accuracy ACROSS the recorded outcomes — derived at answer time, never persisted.
export type { FrequencyCount, MetricAggregate, OutcomeAggregate } from './evaluation/aggregate.js';
export { aggregateOutcomes } from './evaluation/aggregate.js';
