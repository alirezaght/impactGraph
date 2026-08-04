import { z } from 'zod';

import { graphCategoryCountsSchema, graphRenderCategorySchema } from './graph-categories.js';

// `impactgraph graph --analysis <id> --format json` / `export_graph_html` with an `analysisId`
// (PRD §18.4/§18.5) — a specification's predicted blast radius, as data.
//
// Deliberately absent, exactly as in the architecture projection: source text, evidence excerpts,
// evidence identifiers (they embed line ranges) and absolute paths. Present because the §18.5
// evidence payload is the point: likelihood, impact type, directness, hop counts, confidence WITH
// its §14 contributing signals, requirement attribution, and proposed structure kept separate.

export const impactLikelihoodSchema = z.enum([
  'required',
  'likely',
  'possible',
  // Two tiers added by the trial follow-up (item 3): a text-overlap finding is not a prediction,
  // and a component a specification non-goal rules out is excluded, not merely unlikely.
  'lexical-only',
  'unlikely',
  'excluded',
]);

export const impactDirectnessSchema = z.enum(['direct', 'indirect']);

/** Aggregate facts drawn on one component's box. `mixed` directness = reached both ways. */
export const impactNodeFactsSchema = z
  .object({
    likelihood: impactLikelihoodSchema,
    confidence: z.number().min(0).max(1),
    impactTypes: z.array(z.string().min(1)),
    directness: z.enum(['direct', 'indirect', 'mixed']),
    /** 0 = a direct concept match rather than a traversal. */
    minHops: z.number().int().min(0),
    maxHops: z.number().int().min(0),
    requirementIds: z.array(z.string().min(1)),
    impactCount: z.number().int().min(1),
    /** The analysis cites a node the resolved graph does not contain — stated, never dropped. */
    missingFromSnapshot: z.boolean(),
  })
  .strict();

const impactSignalSchema = z
  .object({
    type: z.string().min(1),
    contribution: z.number(),
    description: z.string().optional(),
  })
  .strict();

const impactRequirementRowSchema = z
  .object({
    id: z.string().min(1),
    /** Specification prose as extracted. Never repository source. */
    statement: z.string(),
    priority: z.string().optional(),
    type: z.string().optional(),
    impactCount: z.number().int().min(0),
    componentCount: z.number().int().min(0),
    strongestLikelihood: impactLikelihoodSchema.optional(),
    maxConfidence: z.number().min(0).max(1).optional(),
    warningCodes: z.array(z.string().min(1)),
  })
  .strict();

const impactRowSchema = z
  .object({
    requirementId: z.string().min(1),
    nodeId: z.string().min(1),
    componentName: z.string().min(1),
    groupId: z.string().min(1),
    likelihood: impactLikelihoodSchema,
    impactType: z.string().min(1),
    directness: impactDirectnessSchema,
    confidence: z.number().min(0).max(1),
    hops: z.number().int().min(0),
    dependencyPath: z.array(z.string().min(1)),
    provenance: z.string().min(1),
    knowledgeCategory: graphRenderCategorySchema,
    explanation: z.string(),
    expectedChanges: z.array(z.string()),
    /** §14: the score is never published without the signals it was computed from. */
    signals: z.array(impactSignalSchema),
    /** Count only — evidence identifiers embed line ranges, which this document does not carry. */
    evidenceCount: z.number().int().min(0),
    decision: z.string().optional(),
    decisionReason: z.string().optional(),
    drawn: z.boolean(),
  })
  .strict();

const impactWarningRowSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    requirementId: z.string().min(1).optional(),
  })
  .strict();

const impactTotalsSchema = z
  .object({
    impactCount: z.number().int().min(0),
    componentCount: z.number().int().min(0),
    componentsShown: z.number().int().min(0),
    componentsHidden: z.number().int().min(0),
    requirementCount: z.number().int().min(0),
    requirementsWithImpacts: z.number().int().min(0),
    requirementsWithoutImpacts: z.number().int().min(0),
    byLikelihood: z
      .object({
        required: z.number().int().min(0),
        likely: z.number().int().min(0),
        possible: z.number().int().min(0),
        // Item 3: text-overlap findings and specification exclusions are counted apart from the
        // predictive tiers so a reader can see how much of the result is noise.
        'lexical-only': z.number().int().min(0),
        unlikely: z.number().int().min(0),
        excluded: z.number().int().min(0),
      })
      .strict(),
    byImpactType: z.array(
      z.object({ type: z.string().min(1), count: z.number().int().min(1) }).strict(),
    ),
    byKnowledgeCategory: graphCategoryCountsSchema,
    directCount: z.number().int().min(0),
    indirectCount: z.number().int().min(0),
    hopBuckets: z.array(
      z.object({ hops: z.number().int().min(0), impactCount: z.number().int().min(1) }).strict(),
    ),
    maxHops: z.number().int().min(0),
    crossGroupHops: z.number().int().min(0),
    crossGroupHopsDrawn: z.number().int().min(0),
  })
  .strict();

const proposedNodeRowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    category: z.string().min(1),
    originOptionId: z.string().min(1),
    rationale: z.string(),
    provenance: z.string().min(1),
    knowledgeCategory: graphRenderCategorySchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

const proposedEdgeRowSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    sourceKind: z.string().min(1),
    targetKind: z.string().min(1),
    type: z.string().min(1),
    originOptionId: z.string().min(1),
    rationale: z.string(),
    provenance: z.string().min(1),
    knowledgeCategory: graphRenderCategorySchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** §18.4: proposed structure travels in its own field and is never merged into the current view. */
export const impactProposedFactsSchema = z
  .object({
    nodes: z.array(proposedNodeRowSchema),
    relationships: z.array(proposedEdgeRowSchema),
  })
  .strict();

export const impactViewFactsSchema = z
  .object({
    analysisId: z.string().min(1),
    analysisStatus: z.string().min(1),
    createdAt: z.string().min(1),
    specificationId: z.string().min(1),
    specificationVersion: z.number().int().min(1),
    specificationTitle: z.string().min(1),
    specificationSource: z.string().min(1).optional(),
    /** Snapshot the analysis was computed against — the world it describes. */
    boundSnapshotId: z.string().min(1),
    /** Snapshot whose graph supplied component names; may differ from the bound one. */
    resolvedSnapshotId: z.string().min(1),
    snapshotMatches: z.boolean(),
    specificationStale: z.boolean(),
    currentSpecificationVersion: z.number().int().min(1),
    totals: impactTotalsSchema,
    requirements: z.array(impactRequirementRowSchema),
    impacts: z.array(impactRowSchema),
    warnings: z.array(impactWarningRowSchema),
    proposed: impactProposedFactsSchema.optional(),
  })
  .strict();

export type ImpactViewFactsDto = z.infer<typeof impactViewFactsSchema>;
export type ImpactNodeFactsDto = z.infer<typeof impactNodeFactsSchema>;
