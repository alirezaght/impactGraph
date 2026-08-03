import { z } from 'zod';

// .impactgraph/rules.yml (PRD §27) — deterministic architecture rules. Both shapes evaluate
// without AI; every violation carries evidence. Heuristic rules are a later addition.

/** "domain must not import infrastructure" — forbidden dependency by role or context (§27). */
const dependencyDirectionRuleSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('dependency-direction'),
    description: z.string().optional(),
    /** Role/context of the depending side (at least one of the four selectors per side). */
    sourceRole: z.string().min(1).optional(),
    sourceContext: z.string().min(1).optional(),
    forbiddenTargetRole: z.string().min(1).optional(),
    forbiddenTargetContext: z.string().min(1).optional(),
  })
  .strict()
  .refine((rule) => rule.sourceRole !== undefined || rule.sourceContext !== undefined, {
    message: 'dependency-direction rule needs sourceRole or sourceContext',
  })
  .refine(
    (rule) => rule.forbiddenTargetRole !== undefined || rule.forbiddenTargetContext !== undefined,
    { message: 'dependency-direction rule needs forbiddenTargetRole or forbiddenTargetContext' },
  );

/** "schema changes require migrations" — a change here demands a change there (§27). */
const accompanyingChangeRuleSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('accompanying-change'),
    description: z.string().optional(),
    /** Glob: when a changed file matches this… */
    whenChanged: z.string().min(1),
    /** Glob: …at least one changed file must match this. */
    requireChanged: z.string().min(1),
  })
  .strict();

export const architectureRuleSchema = z.union([
  dependencyDirectionRuleSchema,
  accompanyingChangeRuleSchema,
]);

/**
 * §Z8 — repository-specific detection: match imports (+decorators or calls) → produce a
 * §12-vocabulary node (+edge). Overly broad patterns are invalid (§Z13): at least one
 * concrete import specifier is required and wildcards are rejected.
 */
export const customDetectionRuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    language: z.enum(['typescript']),
    match: z
      .object({
        imports: z
          .array(
            z
              .string()
              .min(3)
              .regex(/^[^*]+$/),
          )
          .min(1),
        decorators: z.array(z.string().min(1)).optional(),
        calls: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .refine((match) => (match.decorators?.length ?? 0) + (match.calls?.length ?? 0) > 0, {
        message: 'custom detection needs at least one decorator or call matcher (§Z13)',
      }),
    produces: z
      .object({
        nodeCategory: z.string().min(1),
        nodeType: z.string().min(1),
        /** Which string argument of the decorator/call names the produced node. */
        nameArgument: z.number().int().min(0).optional(),
        /** Edge from the declaring symbol/file to the produced node (e.g. SUBSCRIBES_TO). */
        edgeType: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type CustomDetectionRuleDto = z.infer<typeof customDetectionRuleSchema>;

export const rulesConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    rules: z.array(architectureRuleSchema).optional(),
    /** §Z8 custom detection rules — versioned, validated, removable, fixture-testable. */
    detections: z.array(customDetectionRuleSchema).optional(),
  })
  .strict();

export type ArchitectureRuleDto = z.infer<typeof architectureRuleSchema>;
export type RulesConfigDto = z.infer<typeof rulesConfigSchema>;

export const DEFAULT_RULES_CONFIG: RulesConfigDto = { schemaVersion: 1 };
