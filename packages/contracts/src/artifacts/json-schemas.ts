import { zodToJsonSchema } from 'zod-to-json-schema';

import { classificationResponseSchema } from '../ai/classification.js';
import { extractionResponseSchema } from '../ai/extraction.js';
import { interpretationResponseSchema } from '../ai/interpretation.js';
import { nlConfigResponseSchema } from '../ai/nl-config.js';
import {
  cliAcceptDeviationOutputSchema,
  cliSelectOptionOutputSchema,
} from '../cli/decision-outputs.js';
import {
  cliAnalyzeOutputSchema,
  cliApproveOutputSchema,
  cliArchitectureOutputSchema,
  cliConfigOutputSchema,
  cliErrorOutputSchema,
  cliExportOutputSchema,
  cliIndexOutputSchema,
  cliInitOutputSchema,
  cliReviewOutputSchema,
  cliStatusOutputSchema,
} from '../cli/outputs.js';
import { aliasesConfigSchema } from '../config/aliases-config.js';
import { architectureConfigSchema } from '../config/architecture-config.js';
import { componentCorrectionSchema } from '../config/corrections.js';
import { configAuditEntrySchema, configOperationSchema } from '../config/operations.js';
import { rulesConfigSchema } from '../config/rules-config.js';
import { workspaceConfigSchema } from '../config/workspace-config.js';
import { implementationContextSchema } from '../export/implementation-context.js';
import { MCP_TOOL_CONTRACTS } from '../tools/tools.js';
import { hostMessageSchema, webviewMessageSchema } from '../webview/messages.js';

import { evidenceRecordArtifactSchema } from './evidence.js';
import { graphEdgeArtifactSchema, graphNodeArtifactSchema } from './graph.js';
import { reviewArtifactSchema } from './review-artifact.js';
import { repositorySnapshotArtifactSchema } from './snapshot.js';

// JSON Schema is GENERATED from the Zod source of truth, committed under schemas/, and diffed
// in review (ADR-0009). Never hand-edit the generated files — change the Zod schema instead.
const toolSchemas = (): Record<string, unknown> => {
  const schemas: Record<string, unknown> = {};
  for (const [name, contract] of Object.entries(MCP_TOOL_CONTRACTS)) {
    schemas[`tools/${name}.input.v1`] = zodToJsonSchema(contract.input, `Tool_${name}_InputV1`);
    schemas[`tools/${name}.output.v1`] = zodToJsonSchema(contract.output, `Tool_${name}_OutputV1`);
  }
  return schemas;
};

const cliSchemas = (): Record<string, unknown> => ({
  'cli/init-output.v1': zodToJsonSchema(cliInitOutputSchema, 'CliInitOutputV1'),
  'cli/index-output.v1': zodToJsonSchema(cliIndexOutputSchema, 'CliIndexOutputV1'),
  'cli/status-output.v1': zodToJsonSchema(cliStatusOutputSchema, 'CliStatusOutputV1'),
  'cli/architecture-output.v1': zodToJsonSchema(
    cliArchitectureOutputSchema,
    'CliArchitectureOutputV1',
  ),
  'cli/config-output.v1': zodToJsonSchema(cliConfigOutputSchema, 'CliConfigOutputV1'),
  'cli/analyze-output.v1': zodToJsonSchema(cliAnalyzeOutputSchema, 'CliAnalyzeOutputV1'),
  'cli/approve-output.v1': zodToJsonSchema(cliApproveOutputSchema, 'CliApproveOutputV1'),
  'cli/review-output.v1': zodToJsonSchema(cliReviewOutputSchema, 'CliReviewOutputV1'),
  'cli/select-option-output.v1': zodToJsonSchema(
    cliSelectOptionOutputSchema,
    'CliSelectOptionOutputV1',
  ),
  'cli/accept-deviation-output.v1': zodToJsonSchema(
    cliAcceptDeviationOutputSchema,
    'CliAcceptDeviationOutputV1',
  ),
  'cli/export-output.v1': zodToJsonSchema(cliExportOutputSchema, 'CliExportOutputV1'),
  'cli/error-output.v1': zodToJsonSchema(cliErrorOutputSchema, 'CliErrorOutputV1'),
});

export const generateArtifactJsonSchemas = (): Record<string, unknown> => ({
  ...toolSchemas(),
  ...cliSchemas(),
  'artifacts/graph-node.v1': zodToJsonSchema(graphNodeArtifactSchema, 'GraphNodeArtifactV1'),
  'artifacts/graph-edge.v1': zodToJsonSchema(graphEdgeArtifactSchema, 'GraphEdgeArtifactV1'),
  'artifacts/evidence-record.v1': zodToJsonSchema(
    evidenceRecordArtifactSchema,
    'EvidenceRecordArtifactV1',
  ),
  'artifacts/repository-snapshot.v1': zodToJsonSchema(
    repositorySnapshotArtifactSchema,
    'RepositorySnapshotArtifactV1',
  ),
  'artifacts/implementation-review.v1': zodToJsonSchema(
    reviewArtifactSchema,
    'ImplementationReviewArtifactV1',
  ),
  'config/workspace-config.v1': zodToJsonSchema(workspaceConfigSchema, 'WorkspaceConfigV1'),
  'config/architecture-config.v1': zodToJsonSchema(
    architectureConfigSchema,
    'ArchitectureConfigV1',
  ),
  'config/aliases-config.v1': zodToJsonSchema(aliasesConfigSchema, 'AliasesConfigV1'),
  'config/rules-config.v1': zodToJsonSchema(rulesConfigSchema, 'RulesConfigV1'),
  'config/operation.v1': zodToJsonSchema(configOperationSchema, 'ConfigOperationV1'),
  'config/component-correction.v1': zodToJsonSchema(
    componentCorrectionSchema,
    'ComponentCorrectionV1',
  ),
  'config/audit-entry.v1': zodToJsonSchema(configAuditEntrySchema, 'ConfigAuditEntryV1'),
  'export/implementation-context.v1': zodToJsonSchema(
    implementationContextSchema,
    'ImplementationContextV1',
  ),
  'ai/extraction-response.v1': zodToJsonSchema(extractionResponseSchema, 'ExtractionResponseV1'),
  'ai/classification-response.v1': zodToJsonSchema(
    classificationResponseSchema,
    'ClassificationResponseV1',
  ),
  'ai/interpretation-response.v1': zodToJsonSchema(
    interpretationResponseSchema,
    'InterpretationResponseV1',
  ),
  'ai/nl-config-response.v1': zodToJsonSchema(nlConfigResponseSchema, 'NlConfigResponseV1'),
  'webview/host-message.v1': zodToJsonSchema(hostMessageSchema, 'WebviewHostMessageV1'),
  'webview/webview-message.v1': zodToJsonSchema(webviewMessageSchema, 'WebviewRequestMessageV1'),
});
