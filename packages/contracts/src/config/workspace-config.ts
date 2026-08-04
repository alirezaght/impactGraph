import { z } from 'zod';

// .impactgraph/config.yml (PRD §16–17) — v1 carries only what the indexer consumes today.
// Strict: unknown keys are configuration errors, surfaced before they silently do nothing.
export const workspaceConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Additional ignore globs merged with the built-in defaults (PRD §40.1). */
    ignore: z.array(z.string().min(1)).optional(),
    /** Framework adapters disabled for this workspace, by adapter id (Story 3.1). */
    disabledFrameworks: z.array(z.string().min(1)).optional(),
    /** Privacy mode (PRD §9). Default: selected-snippets. Never changed silently. */
    privacyMode: z
      .enum(['local-only', 'selected-snippets', 'full-context', 'external-agent'])
      .optional(),
    /**
     * AI provider strategy (PRD §8/§17). Deliberately has NO field for an API key —
     * keys live in SecretStorage or the environment only (§35).
     */
    provider: z
      .object({
        strategy: z.enum(['none', 'external-agent', 'anthropic', 'openai-compatible', 'local']),
        modelId: z.string().min(1).optional(),
        baseUrl: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * Agent ownership mode (§Z6). Default: review — agent changes need approval;
     * autonomous auto-applies SAFE changes only (§Z11); manual blocks agent writes.
     */
    automation: z
      .object({
        mode: z.enum(['autonomous', 'review', 'manual']),
        /**
         * §Z11 configurable boundary: operation kinds treated as SAFE in autonomous mode.
         * Privacy-mode changes can never be declared safe (hard floor, enforced in code).
         */
        safeOperations: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    /**
     * Related repositories analyzed as ONE workspace while keeping separate identities (item 6).
     *
     * Each entry is indexed under its own repository identity and its own snapshot — the point is not
     * to merge them into one repository but to let deterministic correspondences (HTTP routes and
     * clients, OpenAPI operations, event type names, Pub/Sub topics and subscriptions, shared schemas,
     * Terraform resources, Cloud Run service names) join across them.
     *
     * A repository listed here but not present on disk is NOT an error: the outbound boundary is still
     * modelled and its consumer is reported as unresolved, which is the honest answer (item 11).
     */
    repositories: z
      .array(
        z
          .object({
            /** Stable name used in node ids and in every report. */
            name: z.string().min(1),
            /** Path relative to this workspace root, or absolute. */
            path: z.string().min(1),
            /** Set false to keep the registration but skip indexing it this run. */
            enabled: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type WorkspaceConfigDto = z.infer<typeof workspaceConfigSchema>;

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfigDto = { schemaVersion: 1 };
