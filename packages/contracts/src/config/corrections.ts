import { z } from 'zod';

import { operationBaseFields as base } from './operation-base.js';

// PRD §16 — the human correction model, expressed as structured operations and as the records
// they persist in `.impactgraph/architecture.yml`. Corrections are never free-text YAML edits by
// an agent: they travel the same governed path as every other operation (classify → mode gate →
// §Z13 validation → atomic write → §Z12 audit).
//
// `set-component-owner` is the §16 "add ownership" correction. Ownership is a HUMAN ASSERTION
// only: there is no operation, provenance path, or heuristic that fills `owner` from git history
// or from a model. If ownership inference ever ships it arrives as ordinary `git-history` /
// `llm-inferred` knowledge that a human confirms — it is never written into this field directly.
//
// Deliberately NOT modelled here: "split incorrectly grouped components". A split would have to
// invent graph nodes that no deterministic evidence produced, which the graph contract forbids;
// there is no honest committed-configuration representation of it. "Merge duplicate components"
// needs no operation of its own — renaming several component names onto one canonical name IS
// the merge, and the read-time overlay reports the collision as a merge.

/**
 * §16 component markers. Closed vocabulary from day one: §16 enumerates exactly these four.
 * Expanding it later is a breaking change for persisted-config readers, not an additive one.
 */
export const componentMarkerSchema = z.enum(['generated', 'ignored', 'infrastructure', 'shared']);

export type ComponentMarkerDto = z.infer<typeof componentMarkerSchema>;

/**
 * §Z5 precedence source of a committed correction. `human-confirmed` when a human approved the
 * change (levels 1); `agent-approved` when an agent applied it under autonomous mode (level 2).
 * Absent on a record means `human-confirmed` — hand-written YAML is human knowledge (§16).
 */
export const configSourceSchema = z.enum(['human-confirmed', 'agent-approved']);

export type ConfigSourceDto = z.infer<typeof configSourceSchema>;

/** A canonical-name mapping: every graph component named `from` is read as `to` (§16 rename). */
export const componentRenameSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    reason: z.string().min(1).max(500),
    confirmedAt: z.string().min(1),
    source: configSourceSchema.optional(),
  })
  .strict();

export type ComponentRenameDto = z.infer<typeof componentRenameSchema>;

/**
 * §16 confirm/reject relationship. One record per edge; `confirmed: false` means the edge is
 * excluded from the effective view — visibly, with its reason, never silently dropped, and the
 * deterministic graph edge itself is untouched.
 */
export const relationshipDecisionSchema = z
  .object({
    edgeId: z.string().min(1),
    confirmed: z.boolean(),
    reason: z.string().min(1).max(500),
    confirmedAt: z.string().min(1),
    source: configSourceSchema.optional(),
  })
  .strict();

export type RelationshipDecisionDto = z.infer<typeof relationshipDecisionSchema>;

/**
 * The §16 correction operations. One op carries the confirm/reject relationship decision rather
 * than two mirrored ops: the two differ in exactly one boolean, and a single variant keeps the
 * conflict rule ("already recorded with this value") in one place.
 */
export const COMPONENT_CORRECTION_VARIANTS = [
  z
    .object({
      kind: z.literal('rename-component'),
      from: z.string().min(1),
      to: z.string().min(1),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('assign-context'),
      /** Path glob the assignment applies to (a single file path is a valid glob). */
      path: z.string().min(1),
      context: z.string().min(1),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-component-role'),
      path: z.string().min(1),
      /** Open vocabulary — roles are user-defined names referenced by rules.yml, not an enum. */
      role: z.string().min(1),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mark-component'),
      path: z.string().min(1),
      marker: componentMarkerSchema,
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-component-owner'),
      /** Path glob the ownership applies to (a single file path is a valid glob). */
      component: z.string().min(1),
      /**
       * Free-form owner identifier: a team name, a GitHub handle, a distribution list. Not an
       * enum and not email-validated — see `componentAssignmentSchema.owner`. An owner is only
       * ever asserted by a human through this operation; nothing derives one from the repository.
       */
      owner: z.string().min(1).max(200),
      ...base,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-relationship-confirmation'),
      edgeId: z.string().min(1),
      confirmed: z.boolean(),
      ...base,
    })
    .strict(),
] as const;

export const componentCorrectionSchema = z.discriminatedUnion(
  'kind',
  COMPONENT_CORRECTION_VARIANTS,
);

export type ComponentCorrectionDto = z.infer<typeof componentCorrectionSchema>;
