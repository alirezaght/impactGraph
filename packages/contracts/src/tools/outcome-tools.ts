import { z } from 'zod';

import { impactLikelihoodSchema } from '../cli/impact-export.js';
import { impactEvidenceTypeSchema } from '../cli/impact-summary.js';

/**
 * Recording what an implementation actually touched, and the accuracy it makes measurable (item 12).
 *
 * The input is deliberately mostly optional: a caller that only knows the changed files can still
 * record a useful outcome, and one that has symbol-level detail or reviewer corrections can record
 * those too. What is NOT optional is `analysisId` — an outcome with no prediction attached measures
 * nothing.
 */

const changedSymbolSchema = z
  .object({
    filePath: z.string().min(1),
    symbolName: z.string().min(1),
    kind: z.enum(['added', 'removed', 'changed']),
  })
  .strict();

const relationshipChangeSchema = z
  .object({
    /** §12.2 edge type. */
    type: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    kind: z.enum(['added', 'removed']),
  })
  .strict();

const manualFindingSchema = z
  .object({
    note: z.string().min(1),
    filePath: z.string().min(1).optional(),
    /** `risk` — a trap met while implementing. `correction` — a reviewer disputing a prediction. */
    kind: z.enum(['risk', 'correction']),
  })
  .strict();

export const evaluationMetricsSchema = z
  .object({
    analysisId: z.string().min(1),
    actualImpactId: z.string().min(1),
    /** Absent when there were no predictions to judge — never reported as 0 (item 11). */
    precision: z.number().min(0).max(1).optional(),
    recall: z.number().min(0).max(1).optional(),
    truePositives: z.array(z.string().min(1)),
    falsePositives: z.array(z.string().min(1)),
    falseNegatives: z.array(z.string().min(1)),
    /** Mean reciprocal rank of the changed files in the ranked prediction. */
    rankingQuality: z.number().min(0).max(1).optional(),
    missedArtifactCategories: z.array(z.string().min(1)),
    missedRelationshipTypes: z.array(z.string().min(1)),
    /** Which tiers counted as predictions. Precision is meaningless without it. */
    judgedTiers: z.array(impactLikelihoodSchema),
    /** Evidence bases behind the false positives — which rule to look at. */
    falsePositiveBases: z.array(impactEvidenceTypeSchema),
  })
  .strict();

export const OUTCOME_TOOL_CONTRACTS = {
  record_actual_impact: {
    description:
      'Record what an implementation actually changed after the fact, and measure the analysis against it: precision, recall, false positives/negatives, ranking quality, missed artifact categories and missed relationship types. Append-only evidence — it never modifies the analysis and never mutates confirmed repository knowledge. Modifies the workspace.',
    input: z
      .object({
        analysisId: z.string().min(1),
        outcomeId: z.string().min(1).optional(),
        changedFiles: z.array(z.string().min(1)).optional(),
        addedFiles: z.array(z.string().min(1)).optional(),
        removedFiles: z.array(z.string().min(1)).optional(),
        changedSymbols: z.array(changedSymbolSchema).optional(),
        relationshipChanges: z.array(relationshipChangeSchema).optional(),
        contractsChanged: z.array(z.string().min(1)).optional(),
        migrationsChanged: z.array(z.string().min(1)).optional(),
        manualFindings: z.array(manualFindingSchema).optional(),
        note: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        schemaVersion: z.literal(1),
        command: z.literal('record-actual-impact'),
        outcomeId: z.string().min(1),
        analysisId: z.string().min(1),
        recordedAt: z.string().min(1),
        metrics: evaluationMetricsSchema,
        /** Outcomes recorded against this analysis so far, this one included. */
        historyCount: z.number().int().min(1),
        /**
         * Stated on every response: a measured outcome is evidence for a human to review, and
         * ImpactGraph does not change its ranking or its confirmed knowledge from one result.
         */
        note: z.string().min(1),
      })
      .strict(),
  },
} as const;
