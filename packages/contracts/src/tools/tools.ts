import { z } from 'zod';

import { edgeExplanationSchema, nodeExplanationSchema } from '../artifacts/explanation.js';
import {
  cliImpactPageSchema,
  cliImpactSummarySchema,
  impactFiltersSchema,
  queryOutcomeSchema,
} from '../cli/impact-summary.js';
import {
  readinessSchema,
  cliArchitectureOutputSchema,
  cliExportOutputSchema,
  cliIndexOutputSchema,
  cliReviewOutputSchema,
  cliStatusOutputSchema,
} from '../cli/outputs.js';
import {
  constraintSummarySchema,
  evidenceIndependenceSchema,
  planAssessmentSchema,
  preflightFindingSchema,
  requirementClassificationSchema,
} from '../cli/plan-assessment.js';

import { CONFIG_INSPECTION_TOOL_CONTRACTS } from './config-inspection-tools.js';
import { CONFIG_MAINTENANCE_TOOL_CONTRACTS } from './config-maintenance-tools.js';
import { CONFIG_TOOL_CONTRACTS } from './config-tools.js';
import { DECISION_TOOL_CONTRACTS } from './decision-tools.js';
import { GRAPH_EXPORT_TOOL_CONTRACTS } from './graph-export-tools.js';
import { OUTCOME_TOOL_CONTRACTS } from './outcome-tools.js';
import { REFERENCE_TOOL_CONTRACTS } from './reference-tools.js';
import { STRUCTURE_TOOL_CONTRACTS } from './structure-tools.js';

// PRD §21 — the MCP tool boundary. One Zod source of truth per tool, validated on BOTH ends
// (server validates inputs before acting and outputs before returning; callers re-validate).
// Where a tool's payload equals a CLI output document, the exact same schema is reused —
// never a subtly different copy (ADR-0009). Contracts are versioned via each document's
// schemaVersion; tool names are stable (§29.4).

export const MCP_TOOL_PREFIX = 'impactgraph.';

/** A domain-serialized artifact document (validated in full by the domain parsers). */
const serializedArtifactSchema = z
  .object({ schemaVersion: z.number().int().min(1), id: z.string().min(1) })
  .passthrough();

const emptyInputSchema = z.object({}).strict();

const openQuestionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    reason: z.string(),
    affectedRequirementIds: z.array(z.string()),
    severity: z.string().min(1),
    status: z.string().min(1),
    answer: z.string().optional(),
  })
  .strict();

const requirementSummarySchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    type: z.string().min(1),
    concepts: z.array(z.string()),
    actors: z.array(z.string()),
    priority: z.string().optional(),
    status: z.string().min(1),
  })
  .strict();

/**
 * `matchKind` and `score` are additive v1 fields (item 4). They are what makes a conceptual search
 * safe to build on: an `exact` hit is the component the query named; a `lexical` hit is a lead. A
 * caller that cannot tell them apart will treat a coincidence as an answer.
 */
const componentHitSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    type: z.string().min(1),
    path: z.string().min(1).optional(),
    provenance: z.string().min(1),
    matchKind: z.enum(['exact', 'normalized-name', 'conceptual', 'related', 'lexical']).optional(),
    score: z.number().min(0).max(1).optional(),
    matchedOn: z.array(z.string().min(1)).optional(),
  })
  .strict();

const reviewTargetSchema = z.enum(['working-tree', 'commit']);

/**
 * One entry per §21 tool: input schema and output schema. State-modifying tools carry
 * confirmation semantics in the contract (§35): approve_analysis requires the caller to assert
 * the human user confirmed — ImpactGraph never approves silently (§21.1).
 */
export const MCP_TOOL_CONTRACTS = {
  initialize_workspace: {
    description: 'Create the .impactgraph/ workspace layout (idempotent). Modifies the workspace.',
    input: emptyInputSchema,
    output: z.object({ created: z.array(z.string()), alreadyInitialized: z.boolean() }).strict(),
  },
  get_workspace_status: {
    description:
      'Read the current index generation (initialized, indexed, snapshot, counts) plus repository coverage: the derived index state of every registered repository and any discovered-but-unregistered candidate repositories. Call this FIRST to validate workspace coverage before analyzing.',
    input: emptyInputSchema,
    output: cliStatusOutputSchema,
  },
  index_workspace: {
    description:
      'Index the workspace into the local knowledge graph (deterministic, offline): the workspace root plus every registered, present, enabled repository from `repositories:` in .impactgraph/config.yml — one graph spanning all of them. Rebuilds the disposable cache. Register related repositories before indexing when a feature spans them. Returns a COMPACT summary: counts plus a grouped warning report with a small sample of lines. Pass warningDetail:"full" only when you intend to read every warning.',
    input: z.object({ warningDetail: z.enum(['summary', 'full']).optional() }).strict(),
    output: cliIndexOutputSchema,
  },
  submit_specification: {
    description:
      'Submit specification text; persists an immutable version with extracted requirements (PRD §11).',
    input: z.object({ name: z.string().min(1), content: z.string().min(1) }).strict(),
    output: z
      .object({
        specificationId: z.string().min(1),
        version: z.number().int().min(1),
        title: z.string().min(1),
        extractionMode: z.enum(['provider', 'deterministic-fallback', 'unchanged']),
        requirementCount: z.number().int().min(0),
      })
      .strict(),
  },
  get_specification: {
    description: 'Fetch a stored specification version (latest when version is omitted).',
    input: z
      .object({
        specificationId: z.string().min(1),
        version: z.number().int().min(1).optional(),
      })
      .strict(),
    output: serializedArtifactSchema,
  },
  extract_requirements: {
    description: 'List the extracted requirements of the latest specification version.',
    input: z.object({ specificationId: z.string().min(1) }).strict(),
    output: z
      .object({
        specificationId: z.string().min(1),
        version: z.number().int().min(1),
        requirements: z.array(requirementSummarySchema),
      })
      .strict(),
  },
  get_open_questions: {
    description:
      'List clarification questions of the latest specification version, with the §C10 readiness estimate.',
    input: z.object({ specificationId: z.string().min(1) }).strict(),
    output: z
      .object({
        specificationId: z.string().min(1),
        version: z.number().int().min(1),
        openQuestions: z.array(openQuestionSchema),
        readiness: readinessSchema,
      })
      .strict(),
  },
  answer_open_question: {
    description:
      'Answer an open clarification question: appends specification version N+1 and records a persistent clarification ADR (§C9) so the question is not re-asked. Modifies the specification.',
    input: z
      .object({
        specificationId: z.string().min(1),
        questionId: z.string().min(1),
        answer: z.string().min(1),
        reason: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        specificationId: z.string().min(1),
        version: z.number().int().min(1),
        clarificationId: z.string().min(1),
        readiness: readinessSchema,
      })
      .strict(),
  },
  analyze_impact: {
    description:
      'Build an evidence-backed impact analysis for a submitted specification and return a BOUNDED summary: status, extraction quality, index freshness, coverage, counts, the top structural impacts, unmatched requirements, unresolved concepts, blocking questions and important warnings. Validates repository coverage first and auto-indexes registered repositories missing from the current index. When coverage is fundamentally insufficient, workspaceCoverage.status is "insufficient-coverage", the readiness score is WITHHELD, and requiredActions states machine-readable next steps (index/register repositories, confirm candidates, refresh the index, or report limited scope) — follow them instead of treating the partial result as the answer. Lexical-only matches are excluded by default. Use list_impacts for the full paginated detail. Persists a new draft analysis.',
    input: impactFiltersSchema.extend({ specificationId: z.string().min(1) }).strict(),
    output: cliImpactSummarySchema,
  },
  list_impacts: {
    description:
      'Page through the impacts of a stored analysis with dependency paths, evidence bases and §14 confidence signals. Supports topN, minLikelihood, evidenceTypes, includeLexicalOnly, includeExcluded, requirementId and a pagination cursor.',
    input: impactFiltersSchema.extend({ analysisId: z.string().min(1).optional() }).strict(),
    output: cliImpactPageSchema,
  },
  get_impact_analysis: {
    description: 'Fetch a stored impact analysis document by id.',
    input: z.object({ analysisId: z.string().min(1) }).strict(),
    output: serializedArtifactSchema,
  },
  update_impact_decision: {
    description:
      'Append an accept/reject/manual-add decision to an unapproved analysis (append-only, §40.3). Modifies the analysis.',
    input: z
      .object({
        analysisId: z.string().min(1),
        requirementId: z.string().min(1),
        nodeId: z.string().min(1),
        decision: z.enum(['accepted', 'rejected', 'manually-added']),
        reason: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        analysisId: z.string().min(1),
        status: z.string().min(1),
        decisionCount: z.number().int().min(0),
      })
      .strict(),
  },
  approve_analysis: {
    description:
      'Approve an analysis as the frozen review baseline. Requires confirmedByUser: true — the human must have explicitly approved; ImpactGraph never approves on its own (§21.1, §35).',
    input: z
      .object({
        analysisId: z.string().min(1),
        /** The caller asserts a human explicitly confirmed this approval. */
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z.object({ analysisId: z.string().min(1), status: z.literal('approved') }).strict(),
  },
  export_implementation_context: {
    description:
      'Export the §22 implementation context of an approved analysis (latest approved when analysisId is omitted).',
    input: z.object({ analysisId: z.string().min(1).optional() }).strict(),
    output: cliExportOutputSchema,
  },
  review_implementation: {
    description:
      'Compare the approved analysis — or, with allowUnapprovedBaseline: true, an unapproved draft baseline — against the working tree or current commit (§24). Reindexes; findings are inputs to human judgment, never an automatic verdict (§43.6). An unapproved baseline is provisional: the report labels it, caps its confidence, and its deviations cannot be accepted.',
    input: z
      .object({
        target: reviewTargetSchema.optional(),
        /** Additive v1 field: review against this stored analysis instead of the latest approved. */
        analysisId: z.string().min(1).optional(),
        /**
         * Additive v1 field: the caller explicitly asks to compare against a never-approved
         * (draft/reviewed) analysis. Mirrors the confirmedByUser idiom — only `true` parses; the
         * choice is stated, never defaulted. §40.3 stays intact: this never approves anything,
         * and superseded analyses are always rejected as baselines.
         */
        allowUnapprovedBaseline: z.literal(true).optional(),
      })
      .strict(),
    output: cliReviewOutputSchema,
  },
  get_review_report: {
    description:
      'Produce the §38.2 review report: re-runs the deterministic review (accepting the same baseline inputs as review_implementation), or — when reviewId is given — renders the persisted review artifact with its accepted deviations marked (§24.1).',
    input: z
      .object({
        target: reviewTargetSchema.optional(),
        /** Additive v1 field (Story 11.2): render a stored review instead of re-running. */
        reviewId: z.string().min(1).optional(),
        /** Additive v1 field: when re-running, review against this stored analysis. */
        analysisId: z.string().min(1).optional(),
        /** Additive v1 field: when re-running, allow a never-approved baseline (see
         *  review_implementation — same semantics, same provisional labeling). */
        allowUnapprovedBaseline: z.literal(true).optional(),
      })
      .strict(),
    output: cliReviewOutputSchema,
  },
  query_architecture: {
    description:
      'Summarize the indexed architecture: workspaces, packages, node/edge composition — plus the architectural boundaries: declared bounded contexts with membership, per-repository breakdown and cross-repository edges (when related repositories are registered), integration points (topics, queues, webhooks, external APIs, unresolved boundaries), and declared contract documents. Use it to answer "what parts of the architecture will this change touch" and "what am I forgetting" before planning.',
    input: emptyInputSchema,
    output: cliArchitectureOutputSchema,
  },
  explain_node: {
    description:
      'Explain a graph node: provenance, knowledge category, confidence signals, evidence, and edges (§18.5).',
    input: z.object({ nodeId: z.string().min(1) }).strict(),
    output: nodeExplanationSchema,
  },
  explain_edge: {
    description:
      'Explain a graph edge: provenance, knowledge category, confidence signals, and evidence (§18.5).',
    input: z.object({ edgeId: z.string().min(1) }).strict(),
    output: edgeExplanationSchema,
  },
  ...CONFIG_TOOL_CONTRACTS,
  ...CONFIG_INSPECTION_TOOL_CONTRACTS,
  ...CONFIG_MAINTENANCE_TOOL_CONTRACTS,
  ...STRUCTURE_TOOL_CONTRACTS,
  ...DECISION_TOOL_CONTRACTS,
  ...GRAPH_EXPORT_TOOL_CONTRACTS,
  ...OUTCOME_TOOL_CONTRACTS,
  ...REFERENCE_TOOL_CONTRACTS,
  find_components: {
    description:
      'Find components by identifier OR by concept. A conceptual query ("NDA signature request notification message rendering") is matched against names, normalized naming, paths, node kinds and graph neighbourhoods; each hit states its matchKind so an identifier match is distinguishable from a lead. The result carries an explicit query outcome: an empty result says whether the query ran, what scope it covered, and what was not searched.',
    input: z
      .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
        /** Restrict to these §12.1 node types. */
        nodeTypes: z.array(z.string().min(1)).min(1).optional(),
        /** Drop token-overlap-only hits. Default: keep them — discovery wants leads. */
        includeLexical: z.boolean().optional(),
        /**
         * ADR-0017 — what the answer is FOR, which changes what ranks first. Inferred from the
         * query when omitted; state it explicitly when the inference reads your wording wrongly.
         */
        intent: z
          .enum([
            'architecture',
            'planning',
            'implementation',
            'validation',
            'tests',
            'runtime',
            'ownership',
          ])
          .optional(),
      })
      .strict(),
    output: z
      .object({
        components: z.array(componentHitSchema),
        /** Grades of answer present, so a caller sees at a glance what it got. */
        matchKinds: z.array(z.string().min(1)).optional(),
        /** Item 11: the difference between "nothing indexed matches" and "no query ran". */
        outcome: queryOutcomeSchema.optional(),
        /** The intent the ranking used, inferred or explicit. */
        intent: z.string().min(1).optional(),
      })
      .strict(),
  },
  list_constraints: {
    description:
      'List the repository rules ImpactGraph indexed: CI guards, lint boundaries, allowlists and human-declared constraints, with their scope, severity, exemption count and source. `extraction` says how the rule was arrived at — only `recognized` and `declared` constraints can block a plan; `opaque` means a guard exists whose rule could not be read, which is reported rather than hidden.',
    input: z
      .object({
        severity: z.enum(['blocking', 'warning', 'advisory']).optional(),
        kind: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    output: z
      .object({
        constraints: z.array(constraintSummarySchema),
        totalCount: z.number().int().min(0),
        /** Guards seen whose rule was not extracted — the honest limit of this layer. */
        opaqueGuardPaths: z.array(z.string().min(1)),
        guardFilesRead: z.number().int().min(0),
      })
      .strict(),
  },
  list_preflight_findings: {
    description:
      'The explicit red-team view of one analysis: the FULL adversarial finding list the bounded analyze_impact summary sliced to its strongest entries, plus the plan assessment, requirement classifications, evidence independence and what was checked (indexed rule count, unreadable guards). Use it after analyze_impact when the verdict needs its complete justification, or as the "attack the design" deep dive — analysis always red-teams; this tool is where the whole case lives. Defaults to the most recent analysis.',
    input: z
      .object({
        analysisId: z.string().min(1).optional(),
        severity: z.enum(['blocking', 'warning', 'informational']).optional(),
        kind: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        analysisId: z.string().min(1),
        specificationId: z.string().min(1),
        specificationVersion: z.number().int().min(1),
        repositorySnapshotId: z.string().min(1),
        createdAt: z.string().min(1),
        assessment: planAssessmentSchema,
        findings: z.array(preflightFindingSchema),
        totalCount: z.number().int().min(0),
        classifications: z.array(requirementClassificationSchema),
        evidenceIndependence: evidenceIndependenceSchema,
        /** What the adversarial pass actually checked — so "no findings" is auditable. */
        checked: z
          .object({
            analyzers: z.array(z.string().min(1)),
            indexedConstraintCount: z.number().int().min(0),
            opaqueGuardPaths: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
  },
  query_runtime_path: {
    description:
      'Answer "what process actually serves this traffic in production?". Walks the deployment graph from a configured URL through Terraform locals, outputs and variables to the runtime resource, container and handler, and reports the environment variables each process on the path receives. An unresolved chain is reported as unresolved, never completed by guesswork.',
    input: z
      .object({
        /** Matches configured URL or environment-variable names, case-insensitively. */
        urlName: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    output: z
      .object({
        paths: z.array(
          z
            .object({
              id: z.string().min(1),
              hops: z.array(
                z
                  .object({
                    kind: z.string().min(1),
                    nodeId: z.string().min(1),
                    name: z.string().min(1),
                    viaRelation: z.string().min(1).optional(),
                  })
                  .strict(),
              ),
              servingProcess: z.string().min(1).optional(),
              receivedEnvironment: z.array(z.string().min(1)),
              incompleteReason: z.string().min(1).optional(),
            })
            .strict(),
        ),
        totalCount: z.number().int().min(0),
      })
      .strict(),
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOL_CONTRACTS;

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_CONTRACTS) as readonly McpToolName[];
