import { z } from 'zod';

// Index health blocks shared by the analyze summary and the status document (dogfooding item 9:
// operational state — index freshness, warning categories, ignored source — must be visible on
// every surface, not judged by the caller). Extracted from impact-summary.ts so outputs.ts can
// reuse them without an import cycle; impact-summary.ts re-exports for existing consumers.

/** Read-time index freshness (PRD item 10) — derived on every read, never persisted. */
export const indexFreshnessSchema = z
  .object({
    state: z.enum([
      'current',
      'working-tree-modified',
      'behind-head',
      'specification-moved',
      'aged',
      'not-indexed',
    ]),
    stale: z.boolean(),
    reasons: z.array(z.string().min(1)),
    indexedSnapshotId: z.string().min(1).optional(),
    indexedAt: z.string().min(1).optional(),
    currentCommitSha: z.string().min(1).optional(),
    recommendedAction: z.string().min(1).optional(),
  })
  .strict();

export const indexWarningReportSchema = z
  .object({
    totalCount: z.number().int().min(0),
    coverageLosingCount: z.number().int().min(0),
    affectsPredictedArea: z.boolean(),
    groups: z.array(
      z
        .object({
          category: z.enum([
            'parse-failure',
            'unsupported-syntax',
            'unresolved-import',
            'unresolved-symbol',
            'ignored-file',
            'missing-generated-file',
            'external-dependency',
            'stale-index',
            'no-adapter',
            'other',
          ]),
          count: z.number().int().min(0),
          examplePaths: z.array(z.string().min(1)),
          exampleMessage: z.string().min(1).optional(),
          affectsPredictedArea: z.boolean(),
        })
        .strict(),
    ),
    /**
     * Additive v1: true when the groups describe a SAMPLE — the run counted more warnings than
     * the persisted, bounded list this report was built from. `totalCount` is the true total;
     * the groups cover only the sample. Absent when nothing was omitted.
     */
    sampled: z.boolean().optional(),
    /** Additive v1: how many warnings the sample omits. Present exactly when `sampled` is. */
    omittedWarningCount: z.number().int().min(0).optional(),
  })
  .strict();

export type IndexFreshnessDto = z.infer<typeof indexFreshnessSchema>;
export type IndexWarningReportDto = z.infer<typeof indexWarningReportSchema>;
