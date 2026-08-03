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

export const evidenceRecordArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: z.string().min(1),
    source: evidenceSourceSchema,
    repositorySnapshotId: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

export type EvidenceRecordArtifactDto = z.infer<typeof evidenceRecordArtifactSchema>;
