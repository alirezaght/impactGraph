import { z } from 'zod';

import { nodeExplanationSchema } from '../artifacts/explanation.js';
import { readinessSchema } from '../cli/outputs.js';

// The three §18 review surfaces the webview renders, as versioned DTOs. The webview renders and
// requests — it never derives these; the host maps engine results into them (main skill §9).
// Every field a panel shows is present here, so an absent field renders as EXPLICITLY absent
// rather than defaulting to a reassuring value (§43.6).

// --------------------------------------------------------------------------------------------
// §18.2 specification panel
// --------------------------------------------------------------------------------------------

export const specificationRequirementSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    type: z.string().min(1),
    status: z.string().min(1),
    concepts: z.array(z.string()),
    actors: z.array(z.string()),
    priority: z.string().min(1).optional(),
  })
  .strict();

export const specificationQuestionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    reason: z.string(),
    /** blocking | important | minor, as the clarification engine assigned it (§C5). */
    severity: z.string().min(1),
    status: z.string().min(1),
    answer: z.string().min(1).optional(),
    affectedRequirementIds: z.array(z.string()),
  })
  .strict();

export const specificationPanelStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** `empty` = nothing submitted yet; the panel shows its designed empty state, not a blank. */
    status: z.enum(['empty', 'loaded']),
    specification: z
      .object({
        id: z.string().min(1),
        version: z.number().int().min(1),
        title: z.string().min(1),
        rawText: z.string(),
        extractionMode: z.enum(['provider', 'deterministic-fallback', 'unchanged']).optional(),
        updatedAt: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * Text the host imported into the panel editor but has NOT persisted (§18.2 paste/import).
     * Kept apart from `specification.rawText` so an unsaved draft is never mistaken for a
     * stored specification version.
     */
    draft: z
      .object({ name: z.string().min(1), text: z.string() })
      .strict()
      .optional(),
    requirements: z.array(specificationRequirementSchema),
    openQuestions: z.array(specificationQuestionSchema),
    /** §C10 readiness — deterministic over the spec state, absent until a spec exists. */
    readiness: readinessSchema.optional(),
    /** Versions available for `Compare Specification Versions` (§19). */
    availableVersions: z.array(z.number().int().min(1)),
    warnings: z.array(z.string()),
  })
  .strict();

// --------------------------------------------------------------------------------------------
// §18.4 impact graph
// --------------------------------------------------------------------------------------------

export const impactGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** `impact` = a predicted impact; `dependency` = a hop on the dependency path (§18.4). */
    kind: z.enum(['impact', 'dependency']),
    requirementIds: z.array(z.string().min(1)),
    likelihood: z
      .enum(['required', 'likely', 'possible', 'lexical-only', 'unlikely', 'excluded'])
      .optional(),
    impactType: z.string().min(1).optional(),
    directness: z.enum(['direct', 'indirect']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    provenance: z.string().min(1).optional(),
    /** Derived from provenance by the host; absent when provenance is unknown (§3). */
    knowledgeCategory: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    /** §18.4: effective bounded context from the §Z5 overlay. Absent = unassigned, not unknown-yet. */
    context: z.string().min(1).optional(),
    /** §18.4: owning package/workspace. Absent = owned by no declared application. */
    application: z.string().min(1).optional(),
  })
  .strict();

export const impactGraphEdgeSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    label: z.string().min(1),
    directness: z.enum(['direct', 'indirect']),
    knowledgeCategory: z.string().min(1).optional(),
  })
  .strict();

// --------------------------------------------------------------------------------------------
// §18.4 proposed structure — the "proposed" half of current-vs-proposed
// --------------------------------------------------------------------------------------------

/** §14 signals behind a proposal's score: the panel must show WHY a number exists, not just it. */
export const graphConfidenceSignalSchema = z
  .object({
    type: z.string().min(1),
    contribution: z.number(),
    description: z.string().min(1).optional(),
  })
  .strict();

/**
 * The envelope every proposed record carries, mirroring `proposedStructureSchema` in
 * `contracts/cli`. `provenance` is `llm-inferred` in practice; the webview must render it as an
 * AI-assisted interpretation and never as a fact (§3, §43.6).
 */
const proposedRecordFields = {
  /** The §26/§C8 architectural option that implies this record. Proposals never exist alone. */
  originOptionId: z.string().min(1),
  /** Resolved by the host from the analysis's options; absent when the option is not in it. */
  originOptionTitle: z.string().min(1).optional(),
  rationale: z.string().min(1),
  provenance: z.string().min(1),
  /** Derived from provenance by the host, exactly as for current nodes; absent = unknown (§3). */
  knowledgeCategory: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  confidenceSignals: z.array(graphConfidenceSignalSchema),
};

/** A component an option would CREATE. Never a member of `nodes` — that separation is the point. */
export const proposedGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** §12.1 vocabulary — a proposed component is typed like any other. */
    category: z.string().min(1),
    type: z.string().min(1),
    ...proposedRecordFields,
  })
  .strict();

export const proposedGraphRelationshipSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    /** `existing` → an id in `nodes` above; `proposed` → an id in `proposedStructure.nodes`. */
    sourceKind: z.enum(['existing', 'proposed']),
    targetKind: z.enum(['existing', 'proposed']),
    /** §12.2 edge type. */
    type: z.string().min(1),
    /** Literal: a record in this collection is proposed structure and nothing else. */
    status: z.literal('proposed'),
    ...proposedRecordFields,
  })
  .strict();

export const proposedStructureViewSchema = z
  .object({
    nodes: z.array(proposedGraphNodeSchema),
    relationships: z.array(proposedGraphRelationshipSchema),
  })
  .strict();

export const impactGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(['empty', 'loaded']),
    analysisId: z.string().min(1).optional(),
    snapshotId: z.string().min(1).optional(),
    specificationTitle: z.string().min(1).optional(),
    requirements: z.array(
      z.object({ id: z.string().min(1), statement: z.string().min(1) }).strict(),
    ),
    nodes: z.array(impactGraphNodeSchema),
    edges: z.array(impactGraphEdgeSchema),
    /**
     * Nodes the analysis produced — current plus proposed — before ANY visible-node capping. The
     * webview shows "showing N of M" against this number; truncation is never silent (§43.1).
     */
    totalNodeCount: z.number().int().min(0),
    /**
     * §18.4 "display current and proposed relationships". A SEPARATE channel from `nodes`/`edges`,
     * which describe the repository as it is NOW: these describe what an architectural option
     * WOULD create. They are never merged into the current graph (§3) — the UI diffs them, and
     * proposed elements count against the §33 node budget like any other element.
     *
     * Additive and optional: absent means the engine asserted no proposed structure, so a reader
     * of the prior shape keeps its exact meaning and no version bump is owed (ADR-0009).
     */
    proposedStructure: proposedStructureViewSchema.optional(),
    warnings: z.array(z.string()),
  })
  .strict();

// --------------------------------------------------------------------------------------------
// §18.5 evidence panel
// --------------------------------------------------------------------------------------------

export const humanDecisionSchema = z
  .object({
    decision: z.enum(['accepted', 'rejected', 'manually-added']),
    reason: z.string().min(1).optional(),
    recordedAt: z.string().min(1).optional(),
  })
  .strict();

export const evidencePanelStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(['empty', 'loading', 'loaded', 'unavailable']),
    /** Why the panel is empty/unavailable — rendered verbatim, never as a fake result. */
    message: z.string().min(1).optional(),
    target: z
      .object({
        nodeId: z.string().min(1),
        name: z.string().min(1),
        path: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    impact: z
      .object({
        analysisId: z.string().min(1),
        requirementId: z.string().min(1),
        requirementStatement: z.string().min(1),
        /** §18.5 "expected change" — the impact type the engine predicted. */
        expectedChange: z.string().min(1),
        likelihood: z.string().min(1),
        directness: z.enum(['direct', 'indirect']),
        confidence: z.number().min(0).max(1),
        provenance: z.string().min(1).optional(),
        dependencyPath: z.array(z.string().min(1)),
        evidenceFiles: z.array(z.string()),
        /** Evidence files that are test files — the same files, grouped by path, no new claims. */
        relatedTests: z.array(z.string()),
      })
      .strict()
      .optional(),
    /** §14 confidence signals + §18.5 provenance/evidence/ranges from `explain_node`. */
    explanation: nodeExplanationSchema.optional(),
    humanDecisions: z.array(humanDecisionSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export type SpecificationPanelStateDto = z.infer<typeof specificationPanelStateSchema>;
export type SpecificationRequirementDto = z.infer<typeof specificationRequirementSchema>;
export type SpecificationQuestionDto = z.infer<typeof specificationQuestionSchema>;
export type ImpactGraphDto = z.infer<typeof impactGraphSchema>;
export type ImpactGraphNodeDto = z.infer<typeof impactGraphNodeSchema>;
export type ImpactGraphEdgeDto = z.infer<typeof impactGraphEdgeSchema>;
export type GraphConfidenceSignalDto = z.infer<typeof graphConfidenceSignalSchema>;
export type ProposedGraphNodeDto = z.infer<typeof proposedGraphNodeSchema>;
export type ProposedGraphRelationshipDto = z.infer<typeof proposedGraphRelationshipSchema>;
export type ProposedStructureViewDto = z.infer<typeof proposedStructureViewSchema>;
export type EvidencePanelStateDto = z.infer<typeof evidencePanelStateSchema>;
export type HumanDecisionDto = z.infer<typeof humanDecisionSchema>;
