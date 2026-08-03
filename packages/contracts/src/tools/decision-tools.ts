import { z } from 'zod';

import { ACCEPTABLE_DEVIATION_CATEGORIES } from '../artifacts/review-artifact.js';

// Human-decision tools (§26/§C8 option selection, §24.1 accepted deviations) — split from
// tools.ts by responsibility (LOC policy). Both tools record decisions on behalf of a HUMAN:
// the contract itself requires the caller to assert explicit user confirmation (§35, §21.1).

export const DECISION_TOOL_CONTRACTS = {
  select_architectural_option: {
    description:
      'Record the user selecting an AI-assisted architectural option (§26/§C8): appends an ' +
      'ArchitecturalDecision to specification version N+1. The analysis itself is never ' +
      'modified. Requires confirmedByUser: true — the human chose; ImpactGraph never selects ' +
      'its own direction (§21.1, §35). Modifies the specification.',
    input: z
      .object({
        analysisId: z.string().min(1),
        optionId: z.string().min(1),
        /** The caller asserts the human explicitly selected this option. */
        confirmedByUser: z.literal(true),
        /** §C8: the user may modify the option text; the decision records the modified form. */
        modifiedDescription: z.string().min(1).max(2000).optional(),
      })
      .strict(),
    output: z
      .object({
        specificationId: z.string().min(1),
        specificationVersion: z.number().int().min(1),
        decisionId: z.string().min(1),
        decisionRecorded: z.literal(true),
        /** §C8: set when the selection also resolved the option's linked open question. */
        answeredQuestionId: z.string().min(1).optional(),
      })
      .strict(),
  },
  accept_review_deviation: {
    description:
      'Record the user accepting a review discrepancy as an Accepted deviation with a reason ' +
      '(§24.1): appends a decision to the persisted review artifact (latest review when ' +
      'reviewId is omitted). Findings are never rewritten; a re-run review does not inherit ' +
      'acceptance. Requires confirmedByUser: true (§35). Modifies the review artifact.',
    input: z
      .object({
        reviewId: z.string().min(1).optional(),
        nodeId: z.string().min(1),
        /** Disambiguates when one node has several discrepancy findings. */
        category: z.enum(ACCEPTABLE_DEVIATION_CATEGORIES).optional(),
        reason: z.string().min(1).max(2000),
        /** The caller asserts the human explicitly accepted this deviation. */
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z
      .object({
        reviewId: z.string().min(1),
        nodeId: z.string().min(1),
        category: z.enum(ACCEPTABLE_DEVIATION_CATEGORIES),
        acceptedDeviationCount: z.number().int().min(1),
      })
      .strict(),
  },
} as const;
