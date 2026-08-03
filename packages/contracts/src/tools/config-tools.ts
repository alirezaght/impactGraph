import { z } from 'zod';

import { configAuditEntrySchema, configOperationSchema } from '../config/operations.js';

// §Z7/§Z15 configuration tools — split from tools.ts by responsibility (LOC policy).
// Same contract rules: strict inputs, validation on both ends, confirmation semantics in the
// schema for material/mutating operations (§35, §Z11).

const emptyInputSchema = z.object({}).strict();

export const driftItemSchema = z
  .object({
    kind: z.string().min(1),
    subject: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

export const CONFIG_TOOL_CONTRACTS = {
  detect_stack: {
    description:
      'Detected languages, frameworks, and convention signals from repository evidence (§Z4): file extensions, manifests, and graph facts. Deterministic, read-only.',
    input: emptyInputSchema,
    output: z
      .object({
        languages: z.array(z.string()),
        frameworks: z.array(z.string()),
        signals: z.array(z.string()),
      })
      .strict(),
  },
  generate_configuration: {
    description:
      'Detection-first configuration generation (§Z1/§Z4): applies the graph-derived suggestions (contexts for uncovered packages, cleanup of dangling aliases) through the governed, audited operation path. Invoking this tool IS the approval for the generated changes. Modifies configuration.',
    input: emptyInputSchema,
    output: z
      .object({
        applied: z.array(driftItemSchema),
        needsReview: z.array(driftItemSchema),
      })
      .strict(),
  },
  preview_configuration_change: {
    description:
      'Preview a structured configuration operation (§Z7): classification (safe/material) and the resulting document, without writing anything.',
    input: z.object({ operation: configOperationSchema }).strict(),
    output: z
      .object({
        classification: z.enum(['safe', 'material']),
        file: z.string().min(1),
        newDocument: z.record(z.unknown()),
      })
      .strict(),
  },
  apply_configuration_change: {
    description:
      'Apply a structured configuration operation (§Z7). Material changes require approvedByUser: true after confirming with the human (§Z11); every applied change is audited with a rollbackId (§Z12). Modifies configuration.',
    input: z
      .object({
        operation: configOperationSchema,
        approvedByUser: z.boolean().optional(),
      })
      .strict(),
    output: z
      .object({
        rollbackId: z.string().min(1),
        classification: z.enum(['safe', 'material']),
        approval: z.enum(['auto', 'approved']),
        file: z.string().min(1),
      })
      .strict(),
  },
  rollback_configuration_change: {
    description:
      'Undo an audited configuration change by APPENDING a rollback entry (§Z14); the audit trail is never rewritten. Requires confirmedByUser: true. Modifies configuration.',
    input: z
      .object({
        rollbackId: z.string().min(1).optional(),
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z.object({ rollbackId: z.string().min(1), restoredFile: z.string().min(1) }).strict(),
  },
  apply_natural_language_instruction: {
    description:
      'Translate a natural-language configuration instruction (§Z15) into structured operations and apply each through the governed path (mode gate, validation, audit). Material changes need approvedByUser: true. Modifies configuration.',
    input: z
      .object({
        instruction: z.string().min(1).max(1000),
        approvedByUser: z.boolean().optional(),
      })
      .strict(),
    output: z
      .object({
        results: z.array(
          z
            .object({
              operation: configOperationSchema,
              classification: z.enum(['safe', 'material']),
              status: z.enum(['applied', 'rejected']),
              detail: z.string().min(1),
            })
            .strict(),
        ),
        unsupported: z.string().min(1).optional(),
      })
      .strict(),
  },
  get_configuration_warnings: {
    description:
      'Reconcile committed configuration against the current graph (§Z10): stale mappings kept for review, dangling aliases/rules, uncovered packages — with suggested structured operations where one would resolve the item.',
    input: emptyInputSchema,
    output: z
      .object({
        needsReview: z.array(
          z
            .object({
              kind: z.string().min(1),
              subject: z.string().min(1),
              detail: z.string().min(1),
            })
            .strict(),
        ),
        suggestions: z.array(
          z
            .object({
              kind: z.string().min(1),
              subject: z.string().min(1),
              detail: z.string().min(1),
              suggestedOperation: configOperationSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  },
  restore_configuration_version: {
    description:
      'Restore configuration to the state AFTER a chosen audit entry (§Z14), by appending — the trail is never rewritten. Requires confirmedByUser: true. Modifies configuration.',
    input: z.object({ rollbackId: z.string().min(1), confirmedByUser: z.literal(true) }).strict(),
    output: z.object({ rollbackId: z.string().min(1), restoredFile: z.string().min(1) }).strict(),
  },
  get_configuration_history: {
    description: 'The §Z12 configuration audit trail, oldest first.',
    input: emptyInputSchema,
    output: z.object({ entries: z.array(configAuditEntrySchema) }).strict(),
  },
} as const;
