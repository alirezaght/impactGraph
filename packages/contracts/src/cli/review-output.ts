import { z } from 'zod';

import { preflightFindingSchema } from './plan-assessment.js';
import { cliReviewBreakdownSchema } from './review-breakdown.js';
import { cliReviewDriftSchema } from './review-drift.js';

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
      /** Additive v1 value (ADR-0022): planned reuse that stayed unchanged, by design. */
      'reuse-confirmed',
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

/**
 * ADR-0022: the answer, before its evidence. A reader who needs only "did this pass?" reads this
 * block and stops; everything below it is the supporting case. Additive v1 field — absent on
 * producers that predate it, where `discrepanciesFound` remains the (buried) fallback.
 */
const reviewVerdictSchema = z
  .object({
    status: z.enum(['PASS', 'NEEDS_ATTENTION']),
    headline: z.string().min(1),
    counts: z
      .object({
        matched: z.number().int().min(0),
        missing: z.number().int().min(0),
        unexpected: z.number().int().min(0),
        divergent: z.number().int().min(0),
        reuseConfirmed: z.number().int().min(0),
        unverifiable: z.number().int().min(0),
        acceptedDeviations: z.number().int().min(0),
        ruleViolations: z.number().int().min(0),
      })
      .strict(),
    /** The findings that decided a NEEDS_ATTENTION verdict — bounded, never the whole list. */
    decidingFindings: z.array(
      z
        .object({
          category: z.string().min(1),
          nodeId: z.string().min(1),
          explanation: z.string().min(1),
        })
        .strict(),
    ),
    /**
     * How many findings of each category the wire document omitted. The persisted artifact keeps
     * every finding; `get_review_report` pages them. Silence about truncation would read as
     * "that was all of them", which is the failure this block exists to prevent (ADR-0015).
     */
    truncatedFindingCounts: z.record(z.string(), z.number().int().min(1)).optional(),
  })
  .strict();

export type CliReviewVerdict = z.infer<typeof reviewVerdictSchema>;

/** PRD §38.2 review report as JSON. Coverage is an ESTIMATE, never proof (§25). */
export const cliReviewOutputSchema = z
  .object({
    /** FIRST by construction (ADR-0022): the decision precedes the evidence. */
    verdict: reviewVerdictSchema.optional(),
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
        /** Misnomer kept for v1 compatibility: this is the analysis's repositorySnapshotId
         *  whatever the baseline's authority. `baseline` (below) supersedes it. */
        approvedSnapshotId: z.string().min(1),
      })
      .strict(),
    /**
     * Additive v1 field: WHICH analysis the implementation was compared against, and what
     * authority that baseline carries. `authority: 'unapproved-prediction'` marks a review whose
     * baseline was never human-approved — the findings compare the implementation against a
     * draft prediction, not a committed plan (§40.3 approval semantics are untouched).
     * Supersedes `analysis.approvedSnapshotId`. Absent on producers that predate it, which only
     * ever reviewed against an approved analysis — absent therefore means 'approved-contract'.
     */
    baseline: z
      .object({
        analysisId: z.string().min(1),
        /** `superseded` can never be a baseline — a retired record is not a prediction. */
        status: z.enum(['draft', 'reviewed', 'approved']),
        authority: z.enum(['approved-contract', 'unapproved-prediction']),
        snapshotId: z.string().min(1),
      })
      .strict()
      .optional(),
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
    /**
     * Additive v1 field (item 7): the `edgeChanges` ids classified into drift categories with
     * named endpoints — a planning-review signal that never feeds finding categories or
     * `discrepanciesFound`. Absent on producers that predate it.
     */
    drift: cliReviewDriftSchema.optional(),
    /**
     * Additive v1 field (ADR-0017): the approved plan treated as a contract.
     *
     * `drift` above answers "what relationships moved". This answers the different question the
     * review exists for: did the implementation satisfy the design that was approved, and did it
     * introduce anything the design did not account for. Absent when no approved plan was
     * available to check against — never "checked and clean", which the counts below carry.
     */
    planContract: z
      .object({
        findings: z.array(preflightFindingSchema),
        /** Changed paths the plan never mentioned. Not defects — unaccounted-for work. */
        unplannedPaths: z.array(z.string().min(1)),
        /** Paths the plan expected to change and the diff did not touch. */
        unchangedExpectedPaths: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CliReviewOutput = z.infer<typeof cliReviewOutputSchema>;
