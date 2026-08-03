import { z } from 'zod';

import { componentMarkerSchema } from './corrections.js';

// §Z5 — the six configuration-source levels, highest priority first. This vocabulary is the
// contract for "which source won" in the read-time overlay: the graph is never mutated, so every
// effective value has to say where it came from and at which level.

export const CONFIG_PRECEDENCE_LEVELS = [
  'human-confirmed',
  'agent-approved',
  'repo-metadata',
  'deterministic-detection',
  'ai-inferred',
  'defaults',
] as const;

export const configPrecedenceLevelSchema = z.enum(CONFIG_PRECEDENCE_LEVELS);

export type ConfigPrecedenceLevelDto = z.infer<typeof configPrecedenceLevelSchema>;

/** A resolved value plus the level that won and the provenance that level carries (§3, §Z5). */
const resolutionFields = {
  level: configPrecedenceLevelSchema,
  /** 1 = human-confirmed … 6 = defaults. Lower rank wins. */
  rank: z.number().int().min(1).max(6),
  /** PRD §12.3 provenance of the winning source — never upgraded to a stronger category. */
  provenance: z.string().min(1),
  detail: z.string().min(1),
};

const resolvedStringSchema = z
  .object({ value: z.string().min(1).optional(), ...resolutionFields })
  .strict();

export const effectiveMarkerSchema = z
  .object({ marker: componentMarkerSchema, ...resolutionFields })
  .strict();

/** The effective view of one graph component after §16 corrections are overlaid (§Z5). */
export const effectiveComponentSchema = z
  .object({
    nodeId: z.string().min(1),
    /** The deterministic graph name, kept alongside the effective one — never overwritten. */
    graphName: z.string().min(1),
    name: resolvedStringSchema,
    role: resolvedStringSchema,
    context: resolvedStringSchema,
    /**
     * §16 ownership (additive v1 field). Resolves through the same §Z5 ladder as every other
     * correction, but only levels 1/2 (committed configuration) and 6 (defaults) are reachable:
     * ownership is asserted, never detected or inferred.
     */
    owner: resolvedStringSchema.optional(),
    markers: z.array(effectiveMarkerSchema),
    /** Set when a rename maps this component onto a name another component also resolves to. */
    mergedWithNodeIds: z.array(z.string().min(1)),
  })
  .strict();

export type EffectiveComponentDto = z.infer<typeof effectiveComponentSchema>;

/** The effective view of one graph edge: confirmed, rejected (excluded), or undecided (§16). */
export const effectiveRelationshipSchema = z
  .object({
    edgeId: z.string().min(1),
    status: z.enum(['confirmed', 'rejected', 'undecided']),
    /** true only for rejected relationships — excluded from the effective view, not deleted. */
    excluded: z.boolean(),
    reason: z.string().min(1).optional(),
    ...resolutionFields,
  })
  .strict();

export type EffectiveRelationshipDto = z.infer<typeof effectiveRelationshipSchema>;

/** Aggregate correction counts for the architecture surfaces (§16 corrections made visible). */
export const correctionSummarySchema = z
  .object({
    renamed: z.number().int().min(0),
    rolesSet: z.number().int().min(0),
    contextsAssigned: z.number().int().min(0),
    marked: z.number().int().min(0),
    /** Components with a committed owner (§16 ownership). Additive v1 field. */
    ownersSet: z.number().int().min(0).optional(),
    confirmedRelationships: z.number().int().min(0),
    rejectedRelationships: z.number().int().min(0),
    merged: z.number().int().min(0),
  })
  .strict();

export type CorrectionSummaryDto = z.infer<typeof correctionSummarySchema>;
