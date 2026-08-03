import { z } from 'zod';

// .impactgraph/aliases.yml (PRD §16–17) — human-maintained concept → canonical component names.
// Consumed by concept matching (alias matches carry the human-confirmed-mapping signal, §14).

export const aliasesConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Map of specification concept → canonical repository name (e.g. `deal: DealService`). */
    aliases: z.record(z.string().min(1)).optional(),
    /**
     * §Z9 learned exclusions: components that must NOT be suggested as impacts (e.g. a shared
     * type that does not imply ownership). Suppressions surface as analysis warnings.
     */
    exclusions: z
      .array(
        z.object({ component: z.string().min(1), reason: z.string().min(1).optional() }).strict(),
      )
      .optional(),
  })
  .strict();

export type AliasesConfigDto = z.infer<typeof aliasesConfigSchema>;

export const DEFAULT_ALIASES_CONFIG: AliasesConfigDto = { schemaVersion: 1 };
