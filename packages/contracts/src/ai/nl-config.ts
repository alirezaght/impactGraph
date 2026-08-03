import { z } from 'zod';

import { configOperationSchema } from '../config/operations.js';

// §Z15 — natural-language configuration. The model's ONLY job is translating an instruction
// into the existing structured-operation vocabulary; everything downstream (classification,
// mode gate, validation, audit) is the same governed path every configuration change takes.
// An instruction the vocabulary cannot express comes back as zero operations plus a note.

export const nlConfigResponseSchema = z
  .object({
    operations: z.array(configOperationSchema).max(5),
    /** Set when (part of) the instruction is not expressible as structured operations. */
    unsupported: z.string().min(1).optional(),
  })
  .strict();

export type NlConfigResponseDto = z.infer<typeof nlConfigResponseSchema>;
