import { z } from 'zod';

export { snapshotSummarySchema } from './repository-state.js';

import { repositoryIndexStateSchema, snapshotSummarySchema } from './repository-state.js';

/**
 * The `index` command's document.
 *
 * Split out of `outputs.ts` when the bounded warning report was added (ADR-0017): the index result
 * is now a report in its own right rather than a counter plus a string list, and it had grown the
 * shared file past the effective-LOC budget.
 */
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
    /**
     * A BOUNDED sample, not the run's full warning list (ADR-0017).
     *
     * This field used to carry every line: an index of a mid-sized repository returned 792 strings
     * and roughly 91 KB, which exceeded an agent's token budget outright — the tool's answer was
     * unreadable, so the tool was useless however correct it was. The count that matters now lives
     * in `warningSummary`, and the lines are a sample unless `warningDetail: 'full'` was asked for.
     */
    warnings: z.array(z.string()),
    /** Additive v1 (ADR-0017): the true totals, grouped, so a sample is never mistaken for all. */
    warningSummary: z
      .object({
        totalCount: z.number().int().min(0),
        returnedCount: z.number().int().min(0),
        omittedCount: z.number().int().min(0),
        byCategory: z.array(
          z
            .object({
              category: z.string().min(1),
              count: z.number().int().min(0),
              exampleMessage: z.string().min(1).optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    /** Additive v1: which registered repositories this run indexed. */
    repositories: z.array(repositoryIndexStateSchema).optional(),
  })
  .strict();
