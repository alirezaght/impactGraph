import { z } from 'zod';

// Per-repository workspace coverage state (additive v1 on the index/status documents).

/**
 * Machine-readable reason a registered repository is unusable or unindexed (additive v1).
 * Derivations (required actions, coverage verdicts, auto-reindexing) key off this code — the
 * human `reason` sentence is presentation, and rewording it must never change behavior.
 */
export const repositoryReasonCodeSchema = z.enum([
  /** Registered, present and enabled, but absent from the current index — run index_workspace. */
  'not-indexed',
  /** Disabled in configuration: a user decision, not a coverage gap. */
  'disabled',
  /** The declared path does not exist on disk. */
  'path-missing',
  /** The declared path resolves outside the workspace root and is refused (PRD §42.5). */
  'path-outside-root',
]);

/** Per-repository index state, DERIVED from the current snapshot (additive v1). */
export const repositoryIndexStateSchema = z
  .object({
    name: z.string().min(1),
    /** Path relative to the workspace root; absent for the root itself. */
    path: z.string().min(1).optional(),
    indexed: z.boolean(),
    fileCount: z.number().int().min(0),
    /** Why a registered repository is not indexed, when it is not — for humans. */
    reason: z.string().min(1).optional(),
    /** Additive v1: the typed counterpart of `reason` — for programs. */
    reasonCode: repositoryReasonCodeSchema.optional(),
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

export type RepositoryReasonCode = z.infer<typeof repositoryReasonCodeSchema>;
export type RepositoryIndexStateDto = z.infer<typeof repositoryIndexStateSchema>;
export type CandidateRepositoryDto = z.infer<typeof candidateRepositorySchema>;
