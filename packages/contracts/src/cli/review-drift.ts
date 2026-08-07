import { z } from 'zod';

/**
 * Classified architectural drift on the review document (dogfooding item 7, PRD §C15.3).
 *
 * The review already reports which architectural edges appeared or disappeared around the
 * changed files (`edgeChanges`) — as bare edge-id strings. This block classifies those same
 * edges deterministically so cross-boundary structural change is readable without resolving
 * ids by hand. It is a planning-review signal, NOT a finding: it never feeds the §24.1 finding
 * categories or `discrepanciesFound`, and it never blocks anything — a human judges it (§43.6).
 *
 * Honesty rules:
 * - Boundary categories are only produced where the boundary is KNOWN: `cross-context` requires
 *   bounded contexts configured in `.impactgraph/architecture.yml`; `cross-repository` requires
 *   a multi-root workspace roster. Where neither exists the categories are simply absent —
 *   never guessed from directory names.
 * - Lists are bounded per category; anything beyond the cap is COUNTED in `omitted`, never
 *   silently dropped (same rule as `edgeChanges`).
 * - `unmappedContexts` is absent (not empty) when no contexts are configured, so "none touched"
 *   and "could not tell" stay distinguishable.
 */

/** Exactly one category per entry, assigned by precedence (see the classifier's doc). */
export const cliDriftCategorySchema = z.enum([
  'cross-context',
  'cross-repository',
  'direction-reversal',
  'new-dependency',
  'removed-dependency',
  'other',
]);

const cliDriftEndpointSchema = z
  .object({
    nodeId: z.string().min(1),
    nodeName: z.string().min(1),
    /** Configured bounded context owning this endpoint — only when contexts are configured. */
    context: z.string().min(1).optional(),
    /** Registered repository owning this endpoint — only under a multi-root roster. */
    repository: z.string().min(1).optional(),
  })
  .strict();

export const cliDriftEntrySchema = z
  .object({
    edgeId: z.string().min(1),
    edgeType: z.string().min(1),
    direction: z.enum(['added', 'removed']),
    category: cliDriftCategorySchema,
    from: cliDriftEndpointSchema,
    to: cliDriftEndpointSchema,
  })
  .strict();

export const cliReviewDriftSchema = z
  .object({
    /** Classified edge changes, capped per category — deterministic order (category, edge id). */
    entries: z.array(cliDriftEntrySchema),
    /** Per-category counts the cap cut — present only for categories that were truncated. */
    omitted: z.array(
      z.object({ category: cliDriftCategorySchema, count: z.number().int().min(1) }).strict(),
    ),
    /**
     * Configured contexts the diff touched that NO approved predictive impact maps to — the
     * "beyond the feature's footprint" signal (PRD §C15.3). Absent when no contexts are
     * configured: absence means "not assessable", an empty list means "assessed, none".
     */
    unmappedContexts: z
      .object({
        contexts: z.array(z.string().min(1)),
        omitted: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CliDriftCategory = z.infer<typeof cliDriftCategorySchema>;
export type CliDriftEntry = z.infer<typeof cliDriftEntrySchema>;
export type CliReviewDrift = z.infer<typeof cliReviewDriftSchema>;
