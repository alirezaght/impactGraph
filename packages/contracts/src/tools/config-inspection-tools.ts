import { z } from 'zod';

import { aliasesConfigSchema } from '../config/aliases-config.js';
import { architectureConfigSchema } from '../config/architecture-config.js';
import { rulesConfigSchema } from '../config/rules-config.js';
import { configSubjectKindSchema } from '../config/subjects.js';
import { workspaceConfigSchema } from '../config/workspace-config.js';

// §Z7 read-only configuration inspection — split from config-tools.ts by responsibility
// (LOC policy). None of these tools write anything; `validate_configuration` runs the §Z13
// gate over the committed documents without touching them.

const emptyInputSchema = z.object({}).strict();

const CONFIG_FILES = ['config.yml', 'architecture.yml', 'aliases.yml', 'rules.yml'] as const;

const fileValidationSchema = z
  .object({
    file: z.enum(CONFIG_FILES),
    /** false when the file does not exist — absence is valid (defaults apply). */
    present: z.boolean(),
    valid: z.boolean(),
    messages: z.array(z.string().min(1)),
  })
  .strict();

export const CONFIG_INSPECTION_TOOL_CONTRACTS = {
  get_configuration: {
    description:
      'The current committed configuration documents (config.yml, architecture.yml, aliases.yml, rules.yml) as validated DTOs. Missing documents are returned as their empty v1 default. Read-only.',
    input: emptyInputSchema,
    output: z
      .object({
        config: workspaceConfigSchema,
        architecture: architectureConfigSchema,
        aliases: aliasesConfigSchema,
        rules: rulesConfigSchema,
      })
      .strict(),
  },
  validate_configuration: {
    description:
      'Run the §Z13 validation gate over the committed configuration WITHOUT writing: per-file schema validity plus cross-file checks (duplicate context/rule/detection ids, assignments referencing an undefined context, confirmations referencing a missing subject, privacy/provider conflicts). Read-only — an invalid document is reported, never repaired.',
    input: emptyInputSchema,
    output: z
      .object({
        valid: z.boolean(),
        files: z.array(fileValidationSchema),
        crossFileMessages: z.array(z.string().min(1)),
      })
      .strict(),
  },
  explain_configuration: {
    description:
      'Explain one configuration value deterministically (no AI): what it does, which §Z12 audit entry introduced it (with its rollbackId, actor and reason), whether a human confirmed it (§Z5), and what it currently matches in the indexed graph.',
    input: z
      .object({
        /** Context name, component path, alias key, rule id, detection id, or ignore glob. */
        subject: z.string().min(1).max(200),
        /** Narrows the lookup when the same string is used by two kinds. */
        subjectKind: configSubjectKindSchema.optional(),
      })
      .strict(),
    output: z
      .object({
        subject: z.string().min(1),
        found: z.boolean(),
        subjectKind: configSubjectKindSchema.optional(),
        file: z.enum(CONFIG_FILES).optional(),
        description: z.string().min(1),
        /** The configuration fragment exactly as committed. */
        definition: z.record(z.unknown()).optional(),
        /** §Z5: true when a human confirmed this value — generation may never change it. */
        confirmed: z.boolean(),
        /** The audit entry that introduced the value, when the trail records one (§Z12). */
        origin: z
          .object({
            rollbackId: z.string().min(1),
            timestamp: z.string().min(1),
            actorKind: z.enum(['user', 'agent']),
            agentId: z.string().min(1).optional(),
            reason: z.string().min(1),
            confidence: z.number().min(0).max(1).optional(),
          })
          .strict()
          .optional(),
        auditTrail: z.array(
          z
            .object({
              rollbackId: z.string().min(1),
              timestamp: z.string().min(1),
              operationKind: z.string().min(1),
              file: z.string().min(1),
            })
            .strict(),
        ),
        affects: z
          .object({
            nodeCount: z.number().int().min(0),
            sampleNodeIds: z.array(z.string().min(1)),
            detail: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
  },
} as const;
