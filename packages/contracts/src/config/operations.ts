import { z } from 'zod';

import { COMPONENT_CORRECTION_VARIANTS } from './corrections.js';
import { operationBaseFields as base } from './operation-base.js';
import { architectureRuleSchema } from './rules-config.js';
import { configSubjectKindSchema } from './subjects.js';

// §Z7 — structured configuration operations. Agents never rewrite YAML text; they submit
// typed operations that are classified (§Z11), mode-gated (§Z6), validated (§Z13), applied
// atomically, and audited (§Z12). The §16 correction variants live in corrections.ts and are
// spread in here, so "what an agent may submit" and "what a human correction is" cannot drift.

export const configOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add-ignore'), glob: z.string().min(1), ...base }).strict(),
  z.object({ kind: z.literal('remove-ignore'), glob: z.string().min(1), ...base }).strict(),
  z
    .object({
      kind: z.literal('add-alias'),
      alias: z.string().min(1),
      canonical: z.string().min(1),
      ...base,
    })
    .strict(),
  z.object({ kind: z.literal('remove-alias'), alias: z.string().min(1), ...base }).strict(),
  z.object({ kind: z.literal('add-exclusion'), component: z.string().min(1), ...base }).strict(),
  z.object({ kind: z.literal('remove-exclusion'), component: z.string().min(1), ...base }).strict(),
  z
    .object({
      kind: z.literal('add-context'),
      name: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1),
      description: z.string().optional(),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('assign-component'),
      path: z.string().min(1),
      role: z.string().min(1).optional(),
      context: z.string().min(1).optional(),
      ...base,
    })
    .strict(),
  z.object({ kind: z.literal('add-rule'), rule: architectureRuleSchema, ...base }).strict(),
  z.object({ kind: z.literal('remove-rule'), ruleId: z.string().min(1), ...base }).strict(),
  z
    .object({
      kind: z.literal('set-privacy-mode'),
      mode: z.enum(['local-only', 'selected-snippets', 'full-context', 'external-agent']),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-automation-mode'),
      mode: z.enum(['autonomous', 'review', 'manual']),
      ...base,
    })
    .strict(),
  /**
   * §Z5: mark an existing configuration value as human-confirmed. Recorded in
   * architecture.yml `confirmations`; afterwards drift/generation flag it but never change it.
   */
  z
    .object({
      kind: z.literal('confirm-value'),
      subjectKind: configSubjectKindSchema,
      subject: z.string().min(1),
      ...base,
    })
    .strict(),
  ...COMPONENT_CORRECTION_VARIANTS,
]);

export type ConfigOperationDto = z.infer<typeof configOperationSchema>;

/** §Z12 — one audit entry per applied change (or rollback). Values are full documents so a
 *  rollback restores the exact prior state; documents are small committed YAML. */
export const configAuditEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    rollbackId: z.string().min(1),
    timestamp: z.string().min(1),
    actor: z
      .object({
        kind: z.enum(['user', 'agent']),
        agentId: z.string().min(1).optional(),
        modelId: z.string().min(1).optional(),
      })
      .strict(),
    operation: z.record(z.unknown()),
    classification: z.enum(['safe', 'material']),
    /** 'auto' in autonomous mode for safe changes; 'approved' when a human confirmed. */
    approval: z.enum(['auto', 'approved']),
    file: z.string().min(1),
    previousDocument: z.record(z.unknown()).nullable(),
    newDocument: z.record(z.unknown()),
    validationResult: z.literal('valid'),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    repositorySnapshotId: z.string().min(1).optional(),
    /** Set when this entry undoes another entry (§Z14) — audit is never rewritten. */
    rollbackOf: z.string().min(1).optional(),
  })
  .strict();

export type ConfigAuditEntryDto = z.infer<typeof configAuditEntrySchema>;

/** §Z9/§Z16 — a learning proposal derived from corrections or review outcomes. Proposals are
 *  suggestions only; applying one goes through the governed operation path. */
export const learningProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    timestamp: z.string().min(1),
    kind: z.enum(['review-co-change', 'rejected-impact']),
    detail: z.string().min(1),
    suggestedOperation: configOperationSchema.optional(),
  })
  .strict();

export type LearningProposalDto = z.infer<typeof learningProposalSchema>;
