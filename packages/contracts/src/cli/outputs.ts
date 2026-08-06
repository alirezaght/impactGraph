import { z } from 'zod';

import { configPrecedenceLevelSchema, correctionSummarySchema } from '../config/overlay.js';
import { workspaceConfigSchema } from '../config/workspace-config.js';
import { implementationContextSchema } from '../export/implementation-context.js';

import { candidateRepositorySchema, repositoryIndexStateSchema } from './repository-state.js';
import { cliReviewBreakdownSchema } from './review-breakdown.js';

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

const reviewFindingSchema = z
  .object({
    category: z.enum([
      'matched',
      'missing',
      'unexpected',
      'divergent',
      'unverifiable',
      'accepted-deviation',
    ]),
    nodeId: z.string().min(1),
    nodeName: z.string().min(1),
    requirementId: z.string().min(1).optional(),
    explanation: z.string().min(1),
    filePaths: z.array(z.string()),
    /** Additive v1 field (Story 11.2): set when a human accepted this discrepancy (§24.1).
     *  The finding itself is never rewritten — the mark rides alongside it. */
    acceptedDeviation: z
      .object({ reason: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

const requirementCoverageSchema = z
  .object({
    requirementId: z.string().min(1),
    statement: z.string().min(1),
    status: z.enum(['implemented', 'partially-implemented', 'not-found', 'unclear']),
    evidence: z.array(
      z
        .object({
          marker: z.enum(['confirmed', 'missing', 'unclear']),
          note: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

/** §27: deterministic rule violation with the evidence that proves it. */
const ruleViolationSchema = z
  .object({
    ruleId: z.string().min(1),
    message: z.string().min(1),
    filePaths: z.array(z.string()),
    edgeId: z.string().min(1).optional(),
  })
  .strict();

/** PRD §38.2 review report as JSON. Coverage is an ESTIMATE, never proof (§25). */
export const cliReviewOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('review'),
    /** Additive v1 field (Story 11.2): id of the persisted review artifact this document
     *  mirrors — the handle for accepting deviations on THIS review run. */
    reviewId: z.string().min(1).optional(),
    analysis: z
      .object({
        id: z.string().min(1),
        specificationId: z.string().min(1),
        specificationVersion: z.number().int().min(1),
        approvedSnapshotId: z.string().min(1),
      })
      .strict(),
    target: z.enum(['working-tree', 'commit']),
    reviewSnapshotId: z.string().min(1),
    changedFiles: z.array(z.string()),
    findings: z.array(reviewFindingSchema),
    coverage: z.array(requirementCoverageSchema),
    edgeChanges: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }).strict(),
    /** §27 rule violations evaluated on the review delta (Story 8.4). */
    ruleViolations: z.array(ruleViolationSchema),
    /** True when findings contain missing/unexpected/divergent OR any rule is violated. */
    discrepanciesFound: z.boolean(),
    /**
     * Additive v1 field (item 13): the same review, split by the distinction that decides what a
     * reader does about each finding — missed existing vs missed new, false strong predictions with
     * their basis, lexical-only predictions that changed, async/contract/asset/migration changes,
     * non-goal contradictions, and the analyzed scope. Absent on producers that predate it.
     */
    breakdown: cliReviewBreakdownSchema.optional(),
  })
  .strict();

export type CliApproveOutput = z.infer<typeof cliApproveOutputSchema>;
export type CliReviewOutput = z.infer<typeof cliReviewOutputSchema>;

/** `impactgraph export` (§22, §38.1): the implementation context, wrapped for CLI consumers. */
export const cliExportOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('export'),
    context: implementationContextSchema,
  })
  .strict();

export type CliExportOutput = z.infer<typeof cliExportOutputSchema>;

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
