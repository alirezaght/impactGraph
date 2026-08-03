import { z } from 'zod';

// PRD §C4 — interpretation generation. The model proposes competing ARCHITECTURAL readings
// of one requirement as concept lists; everything downstream (impact footprints, divergence,
// materiality, severity) is computed deterministically. Concepts are free text on purpose:
// concept matching validates them against the real graph, so an invented concept matches
// nothing and can never fabricate an impact (§43.2).

export const interpretationResponseSchema = z
  .object({
    interpretations: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            /** The architectural assumption this reading makes, stated as one sentence. */
            assumption: z.string().min(1).max(500),
            /** Components/concepts this reading would touch (matched against the graph). */
            concepts: z.array(z.string().min(1).max(100)).min(1).max(8),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export type InterpretationResponseDto = z.infer<typeof interpretationResponseSchema>;
