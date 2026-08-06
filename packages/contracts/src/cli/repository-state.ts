import { z } from 'zod';

// Per-repository workspace coverage state (additive v1 on the index/status documents).

/** Per-repository index state, DERIVED from the current snapshot (additive v1). */
export const repositoryIndexStateSchema = z
  .object({
    name: z.string().min(1),
    /** Path relative to the workspace root; absent for the root itself. */
    path: z.string().min(1).optional(),
    indexed: z.boolean(),
    fileCount: z.number().int().min(0),
    /** Why a registered repository is not indexed, when it is not. */
    reason: z.string().min(1).optional(),
  })
  .strict();

/** A discovered-but-unregistered repository: a candidate the user must confirm (additive v1). */
export const candidateRepositorySchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    hint: z.string().min(1),
  })
  .strict();

export type RepositoryIndexStateDto = z.infer<typeof repositoryIndexStateSchema>;
export type CandidateRepositoryDto = z.infer<typeof candidateRepositorySchema>;
