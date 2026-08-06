import { z } from 'zod';

import { cliReviewBreakdownSchema } from './review-breakdown.js';

// The §38.2 review report as machine-readable CLI output (PRD §20). Split out of outputs.ts by
// responsibility: everything here describes ONE document — the review report shared verbatim by
// `impactgraph review`, `review_implementation`, and `get_review_report` (ADR-0009).

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
    /** Edge-id lists are capped; the additive omitted counts say how much the cap cut (item 7). */
    edgeChanges: z
      .object({
        added: z.array(z.string()),
        removed: z.array(z.string()),
        omittedAdded: z.number().int().min(0).optional(),
        omittedRemoved: z.number().int().min(0).optional(),
      })
      .strict(),
    /** §27 rule violations evaluated on the review delta (Story 8.4). */
    ruleViolations: z.array(ruleViolationSchema),
    /** True when findings contain missing/unexpected/divergent OR any rule is violated. */
    discrepanciesFound: z.boolean(),
    /**
     * Additive v1 field (item 13): the same review, split by the distinction that decides what a
     * reader does about each finding — missed existing vs missed new, false strong predictions with
     * their basis, lexical-only predictions that changed, async/contract/asset/migration changes,
     * non-goal contradictions, the analyzed scope, and the review's own confidence (item 7).
     * Absent on producers that predate it.
     */
    breakdown: cliReviewBreakdownSchema.optional(),
  })
  .strict();

export type CliReviewOutput = z.infer<typeof cliReviewOutputSchema>;
