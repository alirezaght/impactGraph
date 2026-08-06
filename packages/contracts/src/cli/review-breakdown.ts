import { z } from 'zod';

/**
 * The item-13 review breakdown: the review's findings split by the distinction that decides what a
 * reader does about each one.
 *
 * Additive to `cliReviewOutputSchema`, not a replacement: the concise summary the trials called
 * useful stays exactly as it was, and this rides alongside it.
 */
export const cliReviewBreakdownSchema = z
  .object({
    /** Predicted structurally AND changed. The result working as intended. */
    correctlyPredictedStructural: z.array(z.string().min(1)),
    /** Existing files that changed and were not predicted — a prediction gap. */
    missedChangedFiles: z.array(z.string().min(1)),
    /** NEW files that were not predicted. A category miss, not a path miss (item 8). */
    missedNewFiles: z.array(z.string().min(1)),
    /**
     * Components surfaced only as lexical matches that DID change. The most informative rows in the
     * report: the tool saw them and declined to claim them.
     */
    lexicalOnlyThatChanged: z.array(
      z.object({ path: z.string().min(1), name: z.string().min(1) }).strict(),
    ),
    /** `required`/`likely` predictions that did not change, with the basis that produced them. */
    falseStrongPredictions: z.array(
      z
        .object({
          path: z.string().min(1),
          name: z.string().min(1),
          likelihood: z.string().min(1),
          basis: z.string().min(1),
        })
        .strict(),
    ),
    unexpectedChanges: z.array(z.string().min(1)),
    asyncOrBoundaryChanges: z.array(z.string().min(1)),
    configurationAndAssetChanges: z.array(z.string().min(1)),
    contractChanges: z.array(z.string().min(1)),
    migrationChanges: z.array(z.string().min(1)),
    /** The specification said not to touch it, and the implementation did. Reported, not judged. */
    nonGoalContradictions: z.array(
      z
        .object({
          statement: z.string().min(1),
          changedPaths: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    /** Always present: an empty finding list is unreadable without the scope that produced it. */
    scope: z
      .object({
        approvedSnapshotId: z.string().min(1),
        reviewSnapshotId: z.string().min(1),
        target: z.enum(['working-tree', 'commit']),
        changedFileCount: z.number().int().min(0),
        indexedComponentCount: z.number().int().min(0),
        limitations: z.array(z.string().min(1)),
      })
      .strict(),
    /**
     * Additive v1 field (item 7): how much the review's own verdicts can be trusted, derived
     * DETERMINISTICALLY from measured facts (unverifiable-finding share, unindexed registered
     * repositories, truncated edge-change lists) — never from a model. Always at least one
     * human-readable reason: an unexplained confidence level would not explain itself.
     */
    confidence: z
      .object({
        level: z.enum(['high', 'limited', 'low']),
        reasons: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CliReviewBreakdown = z.infer<typeof cliReviewBreakdownSchema>;
