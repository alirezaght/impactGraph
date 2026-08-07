import { z } from 'zod';

import { configPrecedenceLevelSchema, correctionSummarySchema } from '../config/overlay.js';
import { workspaceConfigSchema } from '../config/workspace-config.js';
import { implementationContextSchema } from '../export/implementation-context.js';

import { impactEvidenceTypeSchema } from './evidence-basis.js';
import { indexFreshnessSchema, indexWarningReportSchema } from './index-health.js';
import { candidateRepositorySchema, repositoryIndexStateSchema } from './repository-state.js';

// Machine-readable CLI output (PRD §20, `--format json`). Every document is versioned and
// validated by the CLI before printing; consumers validate again before trusting.

const snapshotSummarySchema = z
  .object({
    id: z.string().min(1),
    branch: z.string().optional(),
    commitSha: z.string().min(1),
    dirtyWorkingTree: z.boolean(),
    createdAt: z.string().min(1),
  })
  .strict();

export const cliInitOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('init'),
    created: z.array(z.string()),
    alreadyInitialized: z.boolean(),
  })
  .strict();

export const cliIndexOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('index'),
    snapshot: snapshotSummarySchema,
    fileCount: z.number().int().min(0),
    changedFileCount: z.number().int().min(0),
    reusedFileCount: z.number().int().min(0),
    ignoredCount: z.number().int().min(0),
    nodeCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    warnings: z.array(z.string()),
    /** Additive v1: which registered repositories this run indexed. */
    repositories: z.array(repositoryIndexStateSchema).optional(),
  })
  .strict();

export const cliStatusOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('status'),
    initialized: z.boolean(),
    indexed: z.boolean(),
    snapshot: snapshotSummarySchema.optional(),
    counts: z
      .object({
        files: z.number().int().min(0),
        nodes: z.number().int().min(0),
        edges: z.number().int().min(0),
      })
      .strict()
      .optional(),
    lastRun: z
      .object({
        finishedAt: z.string().min(1),
        durationMs: z.number().int().min(0),
        warningCount: z.number().int().min(0),
      })
      .strict()
      .optional(),
    /** Additive v1: registered repositories with their derived index state. */
    repositories: z.array(repositoryIndexStateSchema).optional(),
    /** Additive v1: discovered git directories that are NOT registered — need user confirmation. */
    candidateRepositories: z.array(candidateRepositorySchema).optional(),
    /**
     * Additive v1 (dogfooding item 9): read-time index freshness — the status surface must state
     * whether the index still describes the working tree instead of leaving the judgment to the
     * caller. Absent when nothing is indexed at all.
     */
    freshness: indexFreshnessSchema.optional(),
    /** Additive v1: the last run's warnings, categorized — the same report shape analyze uses. */
    indexWarnings: indexWarningReportSchema.optional(),
    /** Additive v1: files the last run deliberately excluded (ignore globs, .gitignore, size). */
    ignoredCount: z.number().int().min(0).optional(),
    /** Additive v1: roster limitations — what this workspace's analysis does NOT cover, and why. */
    limitations: z.array(z.string().min(1)).optional(),
    /** Additive v1: which build produced this answer. Version only — never an invented hash. */
    server: z
      .object({ name: z.string().min(1), version: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

/** One declared bounded context with its structural membership (item 6). Additive v1. */
const architectureContextSchema = z
  .object({
    name: z.string().min(1),
    /** File/package nodes matching the context's declared globs. */
    memberCount: z.number().int().min(0),
    /** Bounded sample of member paths; absent when the context matches nothing. */
    samplePaths: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** Per-repository slice of the graph, derived from the roster's prefixes (item 6). */
const architectureRepositorySchema = z
  .object({
    name: z.string().min(1),
    nodeCount: z.number().int().min(0),
    fileCount: z.number().int().min(0),
  })
  .strict();

/** One edge whose endpoints live in different registered repositories. */
const crossRepositoryEdgeSampleSchema = z
  .object({
    /** Source node id — feed it to explain_node for the full picture. */
    from: z.string().min(1),
    to: z.string().min(1),
    type: z.string().min(1),
    /** The two owning repositories, source first. */
    repositories: z.array(z.string().min(1)).length(2),
  })
  .strict();

/** A declared contract document: an OpenAPI document or a generated contract (item 6). */
const architectureContractSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    path: z.string().min(1).optional(),
  })
  .strict();

export const cliArchitectureOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('architecture'),
    snapshotId: z.string().min(1),
    workspaces: z.array(z.string()),
    packages: z.array(
      z.object({ name: z.string().min(1), fileCount: z.number().int().min(0) }).strict(),
    ),
    nodeCountsByType: z.record(z.number().int().min(0)),
    edgeCountsByType: z.record(z.number().int().min(0)),
    totalNodes: z.number().int().min(0),
    totalEdges: z.number().int().min(0),
    /**
     * §16/§Z5 read-time overlay. Additive v1 fields: `totalEdges` keeps meaning "edges in the
     * deterministic graph" — rejected relationships are listed explicitly and counted separately
     * rather than silently removed from the totals.
     */
    corrections: correctionSummarySchema.optional(),
    effectiveTotalEdges: z.number().int().min(0).optional(),
    rejectedEdges: z
      .array(
        z
          .object({
            edgeId: z.string().min(1),
            reason: z.string().min(1).optional(),
            level: configPrecedenceLevelSchema,
          })
          .strict(),
      )
      .optional(),
    /**
     * Item 6 — the boundary blocks, all additive v1 and all derived at answer time. Absent means
     * "nothing declared/registered", never "unknown": contexts require `.impactgraph/
     * architecture.yml` entries, the repository blocks require registered related repositories,
     * and the integration/contract blocks require matching nodes in the graph.
     */
    contexts: z.array(architectureContextSchema).optional(),
    repositories: z.array(architectureRepositorySchema).optional(),
    crossRepositoryEdges: z
      .object({
        count: z.number().int().min(0),
        /** Bounded, deterministic sample; the full set stays queryable via explain_edge. */
        samples: z.array(crossRepositoryEdgeSampleSchema),
      })
      .strict()
      .optional(),
    /** Counts by node type over the integration/contract families (topic, webhook, …). */
    integrationPoints: z.record(z.number().int().min(0)).optional(),
    contracts: z.array(architectureContractSchema).optional(),
  })
  .strict();

export const cliConfigOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('config'),
    initialized: z.boolean(),
    config: workspaceConfigSchema,
  })
  .strict();

/** §C10 implementation readiness — deterministic over the spec state, never model-authored. */
export const readinessSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    blockingQuestions: z.number().int().min(0),
    importantQuestions: z.number().int().min(0),
    minorQuestions: z.number().int().min(0),
    /**
     * Requirements the impact analysis tied to no component. Additive and optional: a producer
     * with no analysis in hand (e.g. get_specification) omits it rather than reporting zero,
     * which would assert full coverage it never measured.
     */
    unmatchedRequirements: z.number().int().min(0).optional(),
    recommendedAction: z.string().min(1),
  })
  .strict();

const analyzeImpactSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    likelihood: z.enum(['required', 'likely', 'possible', 'lexical-only', 'unlikely', 'excluded']),
    impactType: z.string().min(1),
    directness: z.enum(['direct', 'indirect']),
    confidence: z.number().min(0).max(1),
    dependencyPath: z.array(z.string().min(1)),
    evidenceFiles: z.array(z.string()),
    /** Additive v1 field: knowledge provenance of the impact (PRD §12.3). */
    provenance: z.string().min(1).optional(),
    /**
     * Additive v1 field: the effective bounded context of the impacted component, resolved
     * through the §Z5 precedence overlay. Enables §18.4 context-level grouping without the UI
     * guessing from path prefixes. Absent when no context is assigned — never inferred.
     */
    context: z.string().min(1).optional(),
    /**
     * Additive v1 field: the package or workspace that CONTAINS the component (§18.4 "group by
     * application"). Absent when no declared package owns it — never derived from the path.
     */
    application: z.string().min(1).optional(),
    /**
     * Additive v1 field (ADR-0015): WHY this impact was selected — the evidence-basis set,
     * strongest first. Absent only from documents produced before the taxonomy existed; a
     * consumer reads absence as the weakest basis, never as "unclassified but fine".
     */
    evidenceTypes: z.array(impactEvidenceTypeSchema).min(1).optional(),
    /**
     * Additive v1 field (ADR-0015): set when the likelihood tier was reduced because this basis
     * did not support the stronger one — the cap must be visible wherever likelihood is.
     */
    tierCappedBy: impactEvidenceTypeSchema.optional(),
  })
  .strict();

/** Signals a proposal's confidence was computed from — the UI must be able to show WHY (§14). */
const confidenceSignalSchema = z
  .object({
    type: z.string().min(1),
    contribution: z.number(),
    description: z.string().min(1).optional(),
  })
  .strict();

/**
 * §18.4 "display current and proposed relationships". Proposed structure is a SEPARATE channel
 * from everything else in this document: `requirements[].impacts` and their dependency paths
 * describe components and relationships that exist NOW, while these describe what an
 * architectural option WOULD create. They are never merged — a consumer diffs them.
 */
const proposedRecordFields = {
  /** The `architecturalOptions[].id` that implies this record. */
  originOptionId: z.string().min(1),
  rationale: z.string().min(1),
  provenance: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  confidenceSignals: z.array(confidenceSignalSchema),
};

/** A component an option would CREATE. Never a graph node — hence the explicit flag on edges. */
const proposedNodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** §12.1 vocabulary — a proposed component is typed like any other. */
    category: z.string().min(1),
    type: z.string().min(1),
    ...proposedRecordFields,
  })
  .strict();

const proposedRelationshipSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    /** `existing` → an id in the deterministic graph; `proposed` → an id in `nodes` above. */
    sourceKind: z.enum(['existing', 'proposed']),
    targetKind: z.enum(['existing', 'proposed']),
    /** §12.2 edge type. */
    type: z.string().min(1),
    status: z.literal('proposed'),
    ...proposedRecordFields,
  })
  .strict();

export const proposedStructureSchema = z
  .object({
    nodes: z.array(proposedNodeSchema),
    relationships: z.array(proposedRelationshipSchema),
  })
  .strict();

const analyzeRequirementSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    impacts: z.array(analyzeImpactSchema),
    openQuestions: z.array(
      z.object({ question: z.string().min(1), severity: z.string().min(1) }).strict(),
    ),
  })
  .strict();

export const cliAnalyzeOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('analyze'),
    specification: z
      .object({
        id: z.string().min(1),
        version: z.number().int().min(1),
        title: z.string().min(1),
        extractionMode: z.enum(['provider', 'deterministic-fallback', 'unchanged']),
        /** Additive v1 field (Story 15.6). */
        readiness: readinessSchema.optional(),
      })
      .strict(),
    analysis: z
      .object({
        id: z.string().min(1),
        snapshotId: z.string().min(1),
        status: z.string().min(1),
        impactCount: z.number().int().min(0),
      })
      .strict(),
    requirements: z.array(analyzeRequirementSchema),
    warnings: z.array(z.string()),
    /** Additive v1 field (Story 15.4): §C8 option-based clarification alternatives. */
    architecturalOptions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            description: z.string().min(1),
            affectedNodeIds: z.array(z.string().min(1)),
            /** §C8: the open question this option answers when selected. */
            linkedQuestionId: z.string().min(1).optional(),
            /** §26 implications, DERIVED from the option's graph footprint (never model prose). */
            implications: z
              .object({
                affectedComponentCount: z.number().int().min(0),
                dataChanges: z.array(z.string().min(1)),
                contractChanges: z.array(z.string().min(1)),
                infrastructureChanges: z.array(z.string().min(1)),
                testingImpact: z.array(z.string().min(1)),
                complexity: z.enum(['low', 'medium', 'high']),
                risks: z.array(z.string().min(1)),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .optional(),
    /**
     * Additive v1 field (§18.4): relationships (and components) the architectural options would
     * create. Absent means the engine asserted no proposed structure — never "unknown", so
     * readers of the prior shape keep their exact meaning (ADR-0009).
     */
    proposedStructure: proposedStructureSchema.optional(),
  })
  .strict();

export type CliAnalyzeOutput = z.infer<typeof cliAnalyzeOutputSchema>;
export type ProposedStructureDto = z.infer<typeof proposedStructureSchema>;

export const cliApproveOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('approve'),
    analysisId: z.string().min(1),
    status: z.literal('approved'),
  })
  .strict();

export type CliApproveOutput = z.infer<typeof cliApproveOutputSchema>;

// The §38.2 review report lives in ./review-output.js; re-exported here so every existing
// consumer keeps its import path (ADR-0009: one schema, no diverging near-duplicate).
export { cliReviewOutputSchema } from './review-output.js';
export type { CliReviewOutput } from './review-output.js';

/** `impactgraph export` (§22, §38.1): the implementation context, wrapped for CLI consumers. */
export const cliExportOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('export'),
    context: implementationContextSchema,
  })
  .strict();

export type CliExportOutput = z.infer<typeof cliExportOutputSchema>;

/**
 * `impactgraph version` / `--version` (dogfooding item 9): which build produced the answer.
 * Version string only — build hashes or dates are a packaging-time follow-up, never invented.
 */
export const cliVersionOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('version'),
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

export type CliVersionOutput = z.infer<typeof cliVersionOutputSchema>;

export const cliErrorOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    error: z
      .object({
        category: z.enum([
          'internalError',
          'warningsFound',
          'reviewDiscrepancies',
          'configurationError',
          'indexingFailure',
          'providerFailure',
          'unsupportedProject',
        ]),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type CliInitOutput = z.infer<typeof cliInitOutputSchema>;
export type CliIndexOutput = z.infer<typeof cliIndexOutputSchema>;
export type CliStatusOutput = z.infer<typeof cliStatusOutputSchema>;
export type CliArchitectureOutput = z.infer<typeof cliArchitectureOutputSchema>;
export type CliConfigOutput = z.infer<typeof cliConfigOutputSchema>;
export type CliErrorOutput = z.infer<typeof cliErrorOutputSchema>;
