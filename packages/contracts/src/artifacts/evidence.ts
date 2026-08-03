import { z } from 'zod';

// Evidence artifact, schemaVersion 1. Source bindings reference files/ranges/keys/commits —
// never full file bodies (privacy choke point, main skill §8).

const sourceRangeSchema = z
  .object({
    startLine: z.number().int().min(1),
    startColumn: z.number().int().min(1),
    endLine: z.number().int().min(1),
    endColumn: z.number().int().min(1),
  })
  .strict();

const fileSourceSchema = z
  .object({
    kind: z.literal('file'),
    filePath: z.string().min(1),
    range: sourceRangeSchema.optional(),
    symbolName: z.string().min(1).optional(),
  })
  .strict();

const configSourceSchema = z
  .object({
    kind: z.literal('config'),
    filePath: z.string().min(1),
    configKey: z.string().min(1),
  })
  .strict();

const gitCommitSourceSchema = z
  .object({
    kind: z.literal('git-commit'),
    commitSha: z.string().min(1),
  })
  .strict();

export const evidenceSourceSchema = z.discriminatedUnion('kind', [
  fileSourceSchema,
  configSourceSchema,
  gitCommitSourceSchema,
]);

/**
 * §12.2.1 derivation diagnostics: how an adapter arrived at a relationship. Additive and optional,
 * so every already-written artifact stays valid. Typed fields rather than a free-text blob —
 * `originalClassification` is what makes the relationship split measurable.
 */
/**
 * §12.1.1 route reference: what a routing producer read at the reference site. Typed fields, not an
 * opaque string, so `method` and `resolution` can be validated and read by a rule rather than
 * pattern-matched out of prose.
 */
const routeReferenceSchema = z
  .object({
    literalPath: z.string().min(1),
    normalizedPath: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    attribute: z.string().min(1),
    resolution: z.enum(['static', 'dynamic']),
  })
  .strict();

export const evidenceDerivationSchema = z
  .object({
    mechanism: z.string().min(1),
    relationship: z.string().min(1),
    producer: z.string().min(1),
    originalClassification: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    routeReference: routeReferenceSchema.optional(),
  })
  .strict();

export const evidenceRecordArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: z.string().min(1),
    source: evidenceSourceSchema,
    derivation: evidenceDerivationSchema.optional(),
    repositorySnapshotId: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

export type EvidenceRecordArtifactDto = z.infer<typeof evidenceRecordArtifactSchema>;
