import { z } from 'zod';

import { cliReviewOutputSchema } from '../cli/outputs.js';

// Persisted implementation-review artifact (PRD §24.1, §28; Story 11.2). The review document
// is frozen at write time; accepted-deviation decisions APPEND — findings are never rewritten,
// and a re-run review is a new artifact that does not inherit prior acceptance.

/** Only genuine discrepancies (§24.1) can be accepted as deviations. */
export const ACCEPTABLE_DEVIATION_CATEGORIES = ['missing', 'unexpected', 'divergent'] as const;

/** A human-confirmed decision accepting one discrepancy finding, with the recorded reason. */
export const acceptedDeviationSchema = z
  .object({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    category: z.enum(ACCEPTABLE_DEVIATION_CATEGORIES),
    reason: z.string().min(1).max(2000),
    /** Who recorded the acceptance — the human, or an agent acting on the human's behalf. */
    actor: z.enum(['user', 'agent']),
    decidedAt: z.string().min(1),
  })
  .strict();

export type AcceptedDeviationDto = z.infer<typeof acceptedDeviationSchema>;

export const reviewArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    createdAt: z.string().min(1),
    /** The full §38.2 review document exactly as produced by the review run. Its additive
     *  `baseline` block is what tells this artifact which analysis it compared against and with
     *  what authority; an absent block means an approved-era artifact (its baseline was the
     *  approved analysis) and is treated as 'approved-contract'. Deviations may only be accepted
     *  on reviews whose baseline authority is 'approved-contract' — accepting a deviation from an
     *  unapproved prediction would launder a draft into a contract. */
    document: cliReviewOutputSchema,
    /** Append-only accepted-deviation decisions bound to THIS review (§24.1). */
    acceptedDeviations: z.array(acceptedDeviationSchema),
  })
  .strict();

export type ReviewArtifactDto = z.infer<typeof reviewArtifactSchema>;
