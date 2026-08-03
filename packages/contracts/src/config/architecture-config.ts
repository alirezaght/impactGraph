import { z } from 'zod';

import {
  componentMarkerSchema,
  componentRenameSchema,
  configSourceSchema,
  relationshipDecisionSchema,
} from './corrections.js';
import { configSubjectKindSchema } from './subjects.js';

// .impactgraph/architecture.yml (PRD §16–17) — human-confirmed context and role assignments.
// Everything here is project knowledge maintained by humans: when read into the graph layer it
// carries `human-confirmed` provenance and takes precedence over detection (§Z5, §43.3).

const contextSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** Path globs owned by this bounded context (e.g. `src/deals/**`). */
    paths: z.array(z.string().min(1)).min(1),
    /** §Z5 level that produced this entry. Absent = human-confirmed (hand-written YAML). */
    source: configSourceSchema.optional(),
  })
  .strict();

const componentAssignmentSchema = z
  .object({
    /** Path glob the assignment applies to (a single file path is a valid glob). */
    path: z.string().min(1),
    /**
     * Architectural role, referenced by rules.yml (e.g. `domain`, `infrastructure`,
     * `generated`, `shared`). Open vocabulary: roles are user-defined names, not an enum.
     */
    role: z.string().min(1).optional(),
    /** Context name; must match a declared context to be meaningful. */
    context: z.string().min(1).optional(),
    /** §16 markers applied to matching files (generated/ignored/infrastructure/shared). */
    markers: z.array(componentMarkerSchema).min(1).optional(),
    /**
     * §16 "add ownership" — who to talk to about this code. Free-form on purpose: a team name,
     * a GitHub handle, a distribution list. Deliberately NOT an enum and NOT email-validated,
     * because ownership vocabularies differ per organization and rejecting a valid team name is
     * worse than accepting an odd one. Descriptive metadata only: nothing in ImpactGraph permits
     * or denies anything based on it, and it is never inferred (git blame says who last touched
     * a file, which is a different claim). Absent means unowned, never "unknown yet".
     */
    owner: z.string().min(1).max(200).optional(),
    /** §Z5 level that produced this entry. Absent = human-confirmed (hand-written YAML). */
    source: configSourceSchema.optional(),
  })
  .strict();

/**
 * §Z5 precedence marker: a configuration value a human explicitly confirmed. Drift detection
 * and detection-first generation may still FLAG a confirmed value, but never propose or apply
 * a change to it — human confirmation supersedes detection. Additive v1 field.
 */
const confirmationSchema = z
  .object({
    subjectKind: configSubjectKindSchema,
    /** Context name / component path / alias key / rule id / detection id / ignore glob. */
    subject: z.string().min(1),
    reason: z.string().min(1).max(500),
    confirmedAt: z.string().min(1),
  })
  .strict();

export const architectureConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    contexts: z.array(contextSchema).optional(),
    components: z.array(componentAssignmentSchema).optional(),
    /** §16 canonical-name corrections. Additive v1 field; renaming onto one name IS a merge. */
    renames: z.array(componentRenameSchema).optional(),
    /** §16 confirmed/rejected relationships, keyed by graph edge id. Additive v1 field. */
    relationships: z.array(relationshipDecisionSchema).optional(),
    /** §Z5 human confirmations across all four documents — see confirmationSchema. */
    confirmations: z.array(confirmationSchema).optional(),
  })
  .strict();

export type ArchitectureConfigDto = z.infer<typeof architectureConfigSchema>;

export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfigDto = { schemaVersion: 1 };
