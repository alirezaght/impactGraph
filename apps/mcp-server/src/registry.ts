import { MCP_TOOL_CONTRACTS } from '@impactgraph/contracts';
import {
  answerQuestion,
  applyAcceptedDeviations,
  applyConfigOperation,
  applyInstruction,
  approveAnalysis,
  classifyOperation,
  configHistory,
  detectConfigDrift,
  detectStack,
  generateConfiguration,
  previewOperation,
  restoreConfigVersion,
  rollbackConfigChange,
  searchComponents,
  buildExportBundle,
  buildExportOutput,
  buildReviewOutput,
  createWorkspaceAiServices,
  explainEdge,
  explainNode,
  loadReviewArtifact,
  recordImpactDecision,
  requireInitialized,
  runReviewPipeline,
  submitSpecification,
  summarizeArchitecture,
} from '@impactgraph/workspace-engine';

import { CONFIG_MAINTENANCE_HANDLERS } from './registry-config.js';
import { DECISION_HANDLERS } from './registry-decisions.js';
import { GRAPH_HANDLERS } from './registry-graph.js';
import { IMPACT_HANDLERS } from './registry-impacts.js';
import { HANDLER_EXTENSIONS } from './registry-read.js';
import { STRUCTURE_HANDLERS } from './registry-structure.js';
import { WORKSPACE_HANDLERS } from './registry-workspace.js';

import type { ToolHandler, ToolHandlerMap } from './handler-types.js';
import type { McpToolName } from '@impactgraph/contracts';
import type { EngineFailure, Failable } from '@impactgraph/workspace-engine';

// Story 12.1/12.2 — tool handlers over the shared workspace engine. Inputs are validated
// against the contract before any handler runs; outputs are validated before they leave the
// server (both ends, ADR-0009). ImpactGraph never approves anything silently: approve_analysis
// only parses when the caller asserts explicit human confirmation (§21.1, §35).

const HANDLERS: ToolHandlerMap = {
  ...WORKSPACE_HANDLERS,
  submit_specification: async (rootDir, input) => {
    const initialized = requireInitialized(rootDir);
    if (!initialized.ok) {
      return initialized;
    }
    const ai = createWorkspaceAiServices(rootDir, {
      apiKey: process.env['IMPACTGRAPH_API_KEY'],
    });
    if (!ai.ok) {
      return ai;
    }
    const submitted = await submitSpecification({
      rootDir,
      specName: input.name,
      rawText: input.content,
      extractor: ai.value.extractor,
    });
    if (!submitted.ok) {
      return submitted;
    }
    const { specification, extractionMode } = submitted.value;
    return {
      ok: true,
      value: {
        specificationId: specification.id,
        version: specification.version,
        title: specification.title,
        extractionMode,
        requirementCount: specification.requirements.length,
      },
    };
  },
  update_impact_decision: async (rootDir, input) => {
    const updated = await recordImpactDecision({ rootDir, ...input });
    if (!updated.ok) {
      return updated;
    }
    return {
      ok: true,
      value: {
        analysisId: updated.value.id,
        status: updated.value.status,
        decisionCount: updated.value.userDecisions.length,
      },
    };
  },
  answer_open_question: async (rootDir, input) => {
    const outcome = await answerQuestion({ rootDir, ...input });
    if (!outcome.ok) {
      return outcome;
    }
    return {
      ok: true,
      value: {
        specificationId: outcome.value.specification.id,
        version: outcome.value.specification.version,
        clarificationId: outcome.value.clarificationId,
        readiness: outcome.value.readiness,
      },
    };
  },
  approve_analysis: async (rootDir, input) => {
    // input.confirmedByUser === true is guaranteed by the contract (§35).
    const approved = await approveAnalysis(rootDir, input.analysisId);
    if (!approved.ok) {
      return approved;
    }
    return { ok: true, value: { analysisId: input.analysisId, status: 'approved' } };
  },
  export_implementation_context: async (rootDir, input) => {
    const bundle = await buildExportBundle(rootDir, input.analysisId);
    if (!bundle.ok) {
      return bundle;
    }
    return { ok: true, value: buildExportOutput(bundle.value.context) };
  },
  review_implementation: async (rootDir, input) => reviewDocument(rootDir, input.target),
  get_review_report: async (rootDir, input) => {
    if (input.reviewId === undefined) {
      return reviewDocument(rootDir, input.target);
    }
    // Story 11.2: render the persisted review with its accepted deviations marked (§24.1).
    const stored = loadReviewArtifact(rootDir, input.reviewId);
    if (!stored.ok) {
      return stored;
    }
    return {
      ok: true,
      value: applyAcceptedDeviations(stored.value.document, stored.value.acceptedDeviations),
    };
  },
  query_architecture: async (rootDir) => {
    const summary = await summarizeArchitecture(rootDir);
    if (!summary.ok) {
      return summary;
    }
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        command: 'architecture',
        ...summary.value,
        workspaces: [...summary.value.workspaces],
        packages: [...summary.value.packages],
      },
    };
  },
  preview_configuration_change: (rootDir, input) => {
    const preview = previewOperation(rootDir, input.operation);
    if (!preview.ok) {
      return Promise.resolve(preview);
    }
    return Promise.resolve({
      ok: true,
      value: {
        classification: classifyOperation(input.operation),
        file: preview.value.file,
        newDocument: preview.value.newDocument,
      },
    });
  },
  apply_configuration_change: (rootDir, input) => {
    const applied = applyConfigOperation({
      rootDir,
      operation: input.operation,
      actor: { kind: 'agent', agentId: 'mcp-client' },
      approvedByUser: input.approvedByUser,
    });
    if (!applied.ok) {
      return Promise.resolve(applied);
    }
    return Promise.resolve({
      ok: true,
      value: {
        rollbackId: applied.value.rollbackId,
        classification: applied.value.classification,
        approval: applied.value.approval,
        file: applied.value.file,
      },
    });
  },
  rollback_configuration_change: (rootDir, input) => {
    // confirmedByUser: true guaranteed by the contract (§35).
    const rolled = rollbackConfigChange({
      rootDir,
      rollbackId: input.rollbackId,
      actor: { kind: 'agent', agentId: 'mcp-client' },
    });
    if (!rolled.ok) {
      return Promise.resolve(rolled);
    }
    return Promise.resolve({
      ok: true,
      value: { rollbackId: rolled.value.rollbackId, restoredFile: rolled.value.file },
    });
  },
  detect_stack: async (rootDir) => {
    const stack = await detectStack(rootDir);
    return stack.ok ? { ok: true, value: stack.value } : stack;
  },
  generate_configuration: async (rootDir) => {
    const generated = await generateConfiguration(rootDir, {
      kind: 'agent',
      agentId: 'mcp-client',
    });
    if (!generated.ok) {
      return generated;
    }
    const strip = (items: readonly { kind: string; subject: string; detail: string }[]) =>
      items.map((item) => ({ kind: item.kind, subject: item.subject, detail: item.detail }));
    return {
      ok: true,
      value: {
        applied: strip(generated.value.applied),
        needsReview: strip(generated.value.needsReview),
      },
    };
  },
  apply_natural_language_instruction: async (rootDir, input) => {
    const ai = createWorkspaceAiServices(rootDir, {
      apiKey: process.env['IMPACTGRAPH_API_KEY'],
    });
    if (!ai.ok) {
      return ai;
    }
    if (ai.value.configTranslator === undefined) {
      return {
        ok: false,
        error: {
          category: 'configurationError',
          message:
            'no AI provider configured — submit structured operations via apply_configuration_change instead',
        },
      };
    }
    const outcome = await applyInstruction({
      rootDir,
      instruction: input.instruction,
      translator: ai.value.configTranslator,
      actor: { kind: 'agent', agentId: 'mcp-client' },
      approvedByUser: input.approvedByUser,
    });
    return outcome;
  },
  get_configuration_warnings: async (rootDir) => {
    const drift = await detectConfigDrift(rootDir);
    if (!drift.ok) {
      return drift;
    }
    return {
      ok: true,
      value: {
        needsReview: drift.value.needsReview.map((item) => ({
          kind: item.kind,
          subject: item.subject,
          detail: item.detail,
        })),
        suggestions: drift.value.suggestions.map((item) => ({
          kind: item.kind,
          subject: item.subject,
          detail: item.detail,
          suggestedOperation: item.suggestedOperation ?? {
            kind: 'add-ignore',
            glob: '?',
            reason: '?',
          },
        })),
      },
    };
  },
  restore_configuration_version: (rootDir, input) => {
    // confirmedByUser: true guaranteed by the contract (§35).
    const restored = restoreConfigVersion(rootDir, input.rollbackId, {
      kind: 'agent',
      agentId: 'mcp-client',
    });
    if (!restored.ok) {
      return Promise.resolve(restored);
    }
    return Promise.resolve({
      ok: true,
      value: { rollbackId: restored.value.rollbackId, restoredFile: restored.value.file },
    });
  },
  get_configuration_history: (rootDir) => {
    const history = configHistory(rootDir);
    return Promise.resolve(history.ok ? { ok: true, value: { entries: history.value } } : history);
  },
  explain_node: (rootDir, input) => explainNode(rootDir, input.nodeId),
  explain_edge: (rootDir, input) => explainEdge(rootDir, input.edgeId),
  find_components: async (rootDir, input) => {
    const found = await searchComponents(rootDir, input.query, {
      limit: input.limit ?? 25,
      ...(input.nodeTypes === undefined ? {} : { nodeTypes: input.nodeTypes }),
      ...(input.includeLexical === undefined ? {} : { includeLexical: input.includeLexical }),
    });
    if (!found.ok) {
      return found;
    }
    return {
      ok: true,
      value: {
        components: found.value.components.map((hit) => ({
          nodeId: hit.nodeId,
          name: hit.name,
          category: hit.category,
          type: hit.type,
          ...(hit.path === undefined ? {} : { path: hit.path }),
          provenance: hit.provenance,
          matchKind: hit.matchKind,
          score: hit.score,
          matchedOn: [...hit.matchedOn],
        })),
        matchKinds: [...found.value.matchKinds],
        outcome: {
          ...found.value.outcome,
          limitations: [...found.value.outcome.limitations],
        },
      },
    };
  },
  ...IMPACT_HANDLERS,
  ...HANDLER_EXTENSIONS,
  ...DECISION_HANDLERS,
  ...STRUCTURE_HANDLERS,
  ...CONFIG_MAINTENANCE_HANDLERS,
  ...GRAPH_HANDLERS,
};

const reviewDocument = async (
  rootDir: string,
  target: 'working-tree' | 'commit' | undefined,
): Promise<Failable<unknown>> => {
  const initialized = requireInitialized(rootDir);
  if (!initialized.ok) {
    return initialized;
  }
  const bundle = await runReviewPipeline(rootDir, target ?? 'working-tree');
  if (!bundle.ok) {
    return bundle;
  }
  return {
    ok: true,
    value: buildReviewOutput(
      bundle.value.review,
      bundle.value.analysis,
      bundle.value.violations,
      bundle.value.breakdownContext,
    ),
  };
};

export type ToolCallOutcome =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly error: EngineFailure };

export const isKnownTool = (name: string): name is McpToolName => name in MCP_TOOL_CONTRACTS;

/** Validate input → run handler → validate output. Both ends, always (ADR-0009). */
export const callTool = async (
  rootDir: string,
  name: McpToolName,
  args: unknown,
): Promise<ToolCallOutcome> => {
  const contract = MCP_TOOL_CONTRACTS[name];
  const input = contract.input.safeParse(args ?? {});
  if (!input.success) {
    return {
      ok: false,
      error: {
        category: 'configurationError',
        message: `invalid input for ${name}: ${input.error.issues[0]?.message ?? 'schema mismatch'}`,
      },
    };
  }
  const handler = HANDLERS[name] as ToolHandler<McpToolName>;
  const result = await handler(rootDir, input.data);
  if (!result.ok) {
    return result;
  }
  const output = contract.output.safeParse(result.value);
  if (!output.success) {
    return {
      ok: false,
      error: {
        category: 'internalError',
        message: `tool output failed contract validation for ${name}: ${output.error.issues[0]?.message ?? 'schema mismatch'}`,
      },
    };
  }
  return { ok: true, payload: output.data };
};
