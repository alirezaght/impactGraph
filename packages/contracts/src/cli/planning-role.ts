import { z } from 'zod';

/**
 * WHAT A FINDING IS FOR — the planning-role vocabulary (ADR-0025), mirroring the domain taxonomy.
 *
 * Its own module for the same reason as the evidence basis: the bounded summary, the full analyze
 * document, the impact export and the filter schema all need it, and a second near-duplicate enum
 * is how two surfaces end up disagreeing about the same record (ADR-0009).
 */
export const planningRoleSchema = z.enum([
  /** Evidence that this surface matters to satisfying the specification. Shown first. */
  'planning-impact',
  /** Structurally reachable, insufficient evidence of impact. Expandable, never primary. */
  'dependency-context',
  /** A name or meaning resemblance. Worth checking, never worth planning around. */
  'investigation-lead',
]);

export type PlanningRoleDto = z.infer<typeof planningRoleSchema>;

export const planningRoleRuleSchema = z.enum([
  'non-goal-excluded',
  'regression-boundary',
  'adversarially-derived',
  'named-by-specification',
  'resolved-by-resemblance',
  'resemblance-only',
  'structural-obligation',
  'architectural-consequence',
  'reachable-only',
]);

/**
 * The split of an analysis between decisions, context, and leads.
 *
 * Reported rather than optimised. A low `planningShare` on a broad specification is an honest
 * result — it says the change touches a large dependency neighbourhood and little of it is a
 * decision — and suppressing it would turn "we looked at a lot and little of it matters" into
 * "we found little", which is a different and false claim.
 */
export const planningSignalSchema = z
  .object({
    planningImpactCount: z.number().int().min(0),
    dependencyContextCount: z.number().int().min(0),
    investigationLeadCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
    planningShare: z.number().min(0).max(1),
    statement: z.string().min(1),
  })
  .strict();

export type PlanningSignalDto = z.infer<typeof planningSignalSchema>;

/**
 * The secondary half, as counts plus the entry points into it — never as a second list of every
 * reachable component. A reader who wants the rows pages `list_impacts` with the role filter; a
 * reader who wants to know whether looking is worth it reads this.
 */
export const dependencyContextSchema = z
  .object({
    /** Distinct components reachable from the plan for which no impact evidence was established. */
    componentCount: z.number().int().min(0),
    /** Distinct components matched by name or meaning alone. */
    investigationLeadCount: z.number().int().min(0),
    /** Counts by impact type, so "40 tests, 12 pages" is visible without listing 52 rows. */
    byImpactType: z.record(z.number().int().min(0)),
    /** The planning impacts most of this context hangs off — where to start if you do look. */
    reachedFrom: z.array(z.string().min(1)),
    /** How to page the full list; never an instruction to guess. */
    howToInspect: z.string().min(1),
  })
  .strict();

export type DependencyContextDto = z.infer<typeof dependencyContextSchema>;

export const unresolvedSurfaceKindSchema = z.enum([
  'new-surface',
  'external-dependency',
  'coverage-gap',
  'terminology-mismatch',
  'insufficient-evidence',
]);

export const conceptShapeSchema = z.enum(['route', 'path', 'identifier', 'term']);

/**
 * A term the specification names that resolves to no indexed artifact.
 *
 * `alternativeKinds` is the load-bearing field: "nothing matches" is consistent with building it,
 * calling it, indexing the repository that holds it, or renaming the concept, and those are
 * opposite plans. A consumer that reads only `kind` gets the best-supported reading; a consumer
 * that needs certainty is told, in the data, that it does not have any.
 */
export const unresolvedSurfaceSchema = z
  .object({
    concept: z.string().min(1),
    shape: conceptShapeSchema,
    kind: unresolvedSurfaceKindSchema,
    alternativeKinds: z.array(unresolvedSurfaceKindSchema),
    rationale: z.string().min(1),
    requirementIds: z.array(z.string().min(1)),
    /**
     * Indexed names that came close without matching. Reported HERE and not as impacts: "something
     * called exportJob exists" is evidence about vocabulary, not a prediction that it changes.
     */
    nearestExisting: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    /** The reader-facing headline, composed in the domain so every surface says the same thing. */
    label: z.string().min(1),
  })
  .strict();

export type UnresolvedSurfaceDto = z.infer<typeof unresolvedSurfaceSchema>;
