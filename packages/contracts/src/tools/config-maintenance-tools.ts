import { z } from 'zod';

import { componentCorrectionSchema } from '../config/corrections.js';
import { configSubjectKindSchema } from '../config/subjects.js';

import { driftItemSchema } from './config-tools.js';

// §Z5/§Z10 configuration maintenance — split from config-tools.ts by responsibility (LOC
// policy). Every tool here MUTATES configuration and therefore goes through the governed
// operation path (classify → mode gate → validate → atomic write → audit) and carries
// confirmation semantics in the contract (§35, §Z11).

export const CONFIG_MAINTENANCE_TOOL_CONTRACTS = {
  refresh_configuration: {
    description:
      'Re-run §Z10 drift detection and re-apply the detection-first suggestions through the governed, audited path — the same generation step as generate_configuration, plus a report of what changed: the files this run touched, and when configuration last changed before it. Invoking this tool IS the approval for the generated changes. Modifies configuration.',
    input: z.object({}).strict(),
    output: z
      .object({
        applied: z.array(driftItemSchema),
        needsReview: z.array(driftItemSchema),
        /** Configuration files written during THIS run (empty when nothing drifted). */
        changedFiles: z.array(z.string().min(1)),
        /** Timestamp of the newest audit entry that existed before this run (§Z12). */
        previousChangeAt: z.string().min(1).optional(),
        changeCountBefore: z.number().int().min(0),
      })
      .strict(),
  },
  confirm_configuration_value: {
    description:
      'Mark one existing configuration value as human-confirmed (§Z5): recorded in architecture.yml `confirmations` through the governed, audited path. Afterwards drift detection still flags the value but generation/refresh never propose or apply a change to it, and remove_stale_configuration skips it. Requires confirmedByUser: true (§35). Modifies configuration.',
    input: z
      .object({
        subjectKind: configSubjectKindSchema,
        subject: z.string().min(1).max(200),
        reason: z.string().min(1).max(500),
        /** The caller asserts a human explicitly confirmed this value. */
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z
      .object({
        rollbackId: z.string().min(1),
        file: z.literal('architecture.yml'),
        subject: z.string().min(1),
        subjectKind: configSubjectKindSchema,
        confirmationCount: z.number().int().min(1),
      })
      .strict(),
  },
  apply_component_correction: {
    description:
      'Apply one §16 human correction to the committed architecture configuration: rename-component (renaming several names onto one canonical name IS the merge), assign-context, set-component-role, mark-component (generated/ignored/infrastructure/shared), set-component-owner (free-form team/handle/list for a path glob), or set-relationship-confirmation (confirm/reject a graph edge). The graph is never mutated — corrections are overlaid at read time with §Z5 precedence. Requires confirmedByUser: true (§35); every change is audited with a rollbackId (§Z12). Splitting a component is deliberately NOT offered: it has no honest committed-configuration representation. Ownership is descriptive metadata only — it gates nothing, and it must come from the user, never from git blame or a guess. Modifies configuration.',
    input: z
      .object({
        correction: componentCorrectionSchema,
        /** The caller asserts a human explicitly confirmed this correction. */
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z
      .object({
        rollbackId: z.string().min(1),
        file: z.literal('architecture.yml'),
        kind: z.string().min(1),
        /** The §Z5 level the persisted record carries — human-confirmed for this tool (§16). */
        source: z.literal('human-confirmed'),
      })
      .strict(),
  },
  remove_stale_configuration: {
    description:
      'Remove the entries §Z10 drift detection flags as stale — dangling aliases and rules referencing an undefined role/context — one governed, audited operation each. Human-confirmed values (§Z5) and anything without a structured removal operation are skipped and reported, never removed silently. Requires confirmedByUser: true (§35). Modifies configuration.',
    input: z
      .object({
        /** Restrict the removal to these subjects; omitted means every stale entry. */
        subjects: z.array(z.string().min(1)).max(100).optional(),
        /** The caller asserts a human explicitly confirmed this removal. */
        confirmedByUser: z.literal(true),
      })
      .strict(),
    output: z
      .object({
        removed: z.array(
          z
            .object({
              kind: z.string().min(1),
              subject: z.string().min(1),
              file: z.string().min(1),
              rollbackId: z.string().min(1),
            })
            .strict(),
        ),
        skipped: z.array(
          z
            .object({
              kind: z.string().min(1),
              subject: z.string().min(1),
              reason: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  },
} as const;
