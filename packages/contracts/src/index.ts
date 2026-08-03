// @impactgraph/contracts — versioned boundary schemas (ADR-0009). Depends on zod only.

export {
  provenanceSchema,
  confidenceSignalSchema,
  confidenceSchema,
  specificationRefSchema,
  knowledgeEnvelopeSchema,
} from './artifacts/knowledge.js';
export type { ProvenanceDto, KnowledgeEnvelopeDto } from './artifacts/knowledge.js';

export { graphNodeArtifactSchema, graphEdgeArtifactSchema } from './artifacts/graph.js';
export type { GraphNodeArtifactDto, GraphEdgeArtifactDto } from './artifacts/graph.js';

export { evidenceSourceSchema, evidenceRecordArtifactSchema } from './artifacts/evidence.js';
export type { EvidenceRecordArtifactDto } from './artifacts/evidence.js';

export { repositoryHeadSchema, repositorySnapshotArtifactSchema } from './artifacts/snapshot.js';
export type { RepositorySnapshotArtifactDto } from './artifacts/snapshot.js';

export {
  reviewArtifactSchema,
  acceptedDeviationSchema,
  ACCEPTABLE_DEVIATION_CATEGORIES,
} from './artifacts/review-artifact.js';
export type { ReviewArtifactDto, AcceptedDeviationDto } from './artifacts/review-artifact.js';

export {
  KNOWLEDGE_CATEGORIES,
  knowledgeCategorySchema,
  knowledgeCategoryForProvenance,
  evidenceRangeSchema,
  knowledgeExplanationSchema,
  nodeExplanationSchema,
  edgeExplanationSchema,
} from './artifacts/explanation.js';
export type {
  KnowledgeCategoryDto,
  KnowledgeExplanationDto,
  NodeExplanationDto,
  EdgeExplanationDto,
  EvidenceRangeDto,
} from './artifacts/explanation.js';

export { generateArtifactJsonSchemas } from './artifacts/json-schemas.js';

export {
  WEBVIEW_PROTOCOL_VERSION,
  webviewEnvelopeSchema,
  parseVersionedMessage,
} from './webview/protocol.js';
export type { MessageParseError, MessageParseResult } from './webview/protocol.js';
export {
  specificationRequirementSchema,
  specificationQuestionSchema,
  specificationPanelStateSchema,
  impactGraphNodeSchema,
  impactGraphEdgeSchema,
  impactGraphSchema,
  graphConfidenceSignalSchema,
  proposedGraphNodeSchema,
  proposedGraphRelationshipSchema,
  proposedStructureViewSchema,
  humanDecisionSchema,
  evidencePanelStateSchema,
} from './webview/panels.js';
export type {
  SpecificationPanelStateDto,
  SpecificationRequirementDto,
  SpecificationQuestionDto,
  ImpactGraphDto,
  ImpactGraphNodeDto,
  ImpactGraphEdgeDto,
  GraphConfidenceSignalDto,
  ProposedGraphNodeDto,
  ProposedGraphRelationshipDto,
  ProposedStructureViewDto,
  EvidencePanelStateDto,
  HumanDecisionDto,
} from './webview/panels.js';
export {
  hostMessageSchema,
  webviewMessageSchema,
  HOST_MESSAGE_TYPES,
  WEBVIEW_MESSAGE_TYPES,
  parseHostMessage,
  parseWebviewMessage,
} from './webview/messages.js';
export type { HostMessage, WebviewMessage } from './webview/messages.js';

export { EXIT_CODES, EXIT_CODE_NAMES } from './cli/exit-codes.js';
export type { ExitCode, ExitCodeName } from './cli/exit-codes.js';
export {
  cliInitOutputSchema,
  cliIndexOutputSchema,
  cliStatusOutputSchema,
  cliArchitectureOutputSchema,
  cliConfigOutputSchema,
  cliAnalyzeOutputSchema,
  proposedStructureSchema,
  readinessSchema,
  cliApproveOutputSchema,
  cliReviewOutputSchema,
  cliExportOutputSchema,
  cliErrorOutputSchema,
} from './cli/outputs.js';
export type {
  CliInitOutput,
  CliIndexOutput,
  CliStatusOutput,
  CliArchitectureOutput,
  CliConfigOutput,
  CliAnalyzeOutput,
  ProposedStructureDto,
  CliApproveOutput,
  CliReviewOutput,
  CliExportOutput,
  CliErrorOutput,
} from './cli/outputs.js';
export {
  cliSelectOptionOutputSchema,
  cliAcceptDeviationOutputSchema,
} from './cli/decision-outputs.js';
export type { CliSelectOptionOutput, CliAcceptDeviationOutput } from './cli/decision-outputs.js';

export { workspaceConfigSchema, DEFAULT_WORKSPACE_CONFIG } from './config/workspace-config.js';
export type { WorkspaceConfigDto } from './config/workspace-config.js';
export {
  architectureConfigSchema,
  DEFAULT_ARCHITECTURE_CONFIG,
} from './config/architecture-config.js';
export type { ArchitectureConfigDto } from './config/architecture-config.js';
export { aliasesConfigSchema, DEFAULT_ALIASES_CONFIG } from './config/aliases-config.js';
export { configOperationSchema, configAuditEntrySchema } from './config/operations.js';
export type { ConfigOperationDto, ConfigAuditEntryDto } from './config/operations.js';
export { configSubjectKindSchema } from './config/subjects.js';
export type { ConfigSubjectKindDto } from './config/subjects.js';
export { learningProposalSchema } from './config/operations.js';
export type { LearningProposalDto } from './config/operations.js';
export type { AliasesConfigDto } from './config/aliases-config.js';
export {
  rulesConfigSchema,
  architectureRuleSchema,
  DEFAULT_RULES_CONFIG,
} from './config/rules-config.js';
export type { RulesConfigDto, ArchitectureRuleDto } from './config/rules-config.js';
export { customDetectionRuleSchema } from './config/rules-config.js';
export type { CustomDetectionRuleDto } from './config/rules-config.js';
export {
  componentMarkerSchema,
  configSourceSchema,
  componentRenameSchema,
  relationshipDecisionSchema,
  componentCorrectionSchema,
} from './config/corrections.js';
export type {
  ComponentMarkerDto,
  ConfigSourceDto,
  ComponentRenameDto,
  RelationshipDecisionDto,
  ComponentCorrectionDto,
} from './config/corrections.js';
export {
  CONFIG_PRECEDENCE_LEVELS,
  configPrecedenceLevelSchema,
  effectiveComponentSchema,
  effectiveRelationshipSchema,
  effectiveMarkerSchema,
  correctionSummarySchema,
} from './config/overlay.js';
export type {
  ConfigPrecedenceLevelDto,
  EffectiveComponentDto,
  EffectiveRelationshipDto,
  CorrectionSummaryDto,
} from './config/overlay.js';

export { extractionResponseSchema } from './ai/extraction.js';
export type { ExtractionResponseDto } from './ai/extraction.js';
export { classificationResponseSchema } from './ai/classification.js';
export { interpretationResponseSchema } from './ai/interpretation.js';
export { nlConfigResponseSchema } from './ai/nl-config.js';
export type { NlConfigResponseDto } from './ai/nl-config.js';
export type { InterpretationResponseDto } from './ai/interpretation.js';
export type { ClassificationResponseDto } from './ai/classification.js';
export { implementationContextSchema } from './export/implementation-context.js';
export type { ImplementationContextDto } from './export/implementation-context.js';
export { MCP_TOOL_CONTRACTS, MCP_TOOL_NAMES, MCP_TOOL_PREFIX } from './tools/tools.js';
export type { McpToolName } from './tools/tools.js';
