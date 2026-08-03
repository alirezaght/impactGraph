import { z } from 'zod';

// CLI JSON documents for the human decision commands (PRD §20, §26/§C8, §24.1) — split from
// outputs.ts by responsibility (LOC policy). Same rules: versioned, strict, validated before
// printing and again by consumers (ADR-0009).

/** `impactgraph select-option` (§26/§C8): a user selected an AI-assisted architectural
 *  option; the selection was recorded as an ArchitecturalDecision on specification vN+1. */
export const cliSelectOptionOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('select-option'),
    analysisId: z.string().min(1),
    optionId: z.string().min(1),
    specificationId: z.string().min(1),
    specificationVersion: z.number().int().min(1),
    decisionId: z.string().min(1),
    /** §C8: set when the selection also resolved the option's linked open question. */
    answeredQuestionId: z.string().min(1).optional(),
  })
  .strict();

export type CliSelectOptionOutput = z.infer<typeof cliSelectOptionOutputSchema>;

/** `impactgraph review accept` (§24.1): an accepted-deviation decision was appended to the
 *  review artifact. Findings are never rewritten; re-run reviews do not inherit acceptance. */
export const cliAcceptDeviationOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('review-accept'),
    reviewId: z.string().min(1),
    nodeId: z.string().min(1),
    category: z.enum(['missing', 'unexpected', 'divergent']),
    reason: z.string().min(1),
    acceptedDeviationCount: z.number().int().min(1),
  })
  .strict();

export type CliAcceptDeviationOutput = z.infer<typeof cliAcceptDeviationOutputSchema>;
