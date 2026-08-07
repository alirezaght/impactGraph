import { z } from 'zod';

/**
 * WHY an impact was selected — the closed evidence-basis vocabulary (ADR-0015), mirroring the
 * domain taxonomy. Lives in its own module so the bounded summary (`impact-summary.ts`) and the
 * full analyze document (`outputs.ts`) can share it without an import cycle; `impact-summary.ts`
 * re-exports it so every existing consumer keeps its import path (ADR-0009: one schema, no
 * diverging near-duplicate).
 */
export const impactEvidenceTypeSchema = z.enum([
  'direct-structural',
  'transitive-structural',
  'async-event',
  'external-contract',
  'field-data-flow',
  'configuration-asset',
  /** Additive v1: deterministic fuzzy name match — capped at `likely`, never `required`. */
  'name-similarity',
  'semantic-match',
  'lexical-only',
]);

export type ImpactEvidenceTypeDto = z.infer<typeof impactEvidenceTypeSchema>;
