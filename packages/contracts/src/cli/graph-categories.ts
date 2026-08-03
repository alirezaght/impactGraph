import { z } from 'zod';

import { KNOWLEDGE_CATEGORIES } from '../artifacts/explanation.js';

// Shared by both halves of the graph-export contract (architecture and impact), so neither has to
// import the other — the two schema modules stay acyclic.

/**
 * The four §12.3 knowledge categories plus an explicit `unknown`. §43.6: an unrecognized
 * provenance must be rendered as unknown, never silently defaulted to "deterministic".
 */
export const graphRenderCategorySchema = z.enum([...KNOWLEDGE_CATEGORIES, 'unknown'] as const);

export const graphCategoryCountsSchema = z
  .object({
    deterministic: z.number().int().min(0),
    'ai-inferred': z.number().int().min(0),
    'human-confirmed': z.number().int().min(0),
    reserved: z.number().int().min(0),
    unknown: z.number().int().min(0),
  })
  .strict();
