import { z } from 'zod';

// Repository snapshot artifact, schemaVersion 1 (PRD §23.1).

const branchHeadSchema = z
  .object({
    kind: z.literal('branch'),
    branch: z.string().min(1),
    commitSha: z.string().regex(/^[0-9a-f]{4,40}$/i),
  })
  .strict();

const detachedHeadSchema = z
  .object({
    kind: z.literal('detached'),
    commitSha: z.string().regex(/^[0-9a-f]{4,40}$/i),
  })
  .strict();

export const repositoryHeadSchema = z.discriminatedUnion('kind', [
  branchHeadSchema,
  detachedHeadSchema,
]);

export const repositorySnapshotArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    repositoryIdentity: z.string().min(1),
    head: repositoryHeadSchema,
    dirtyWorkingTree: z.boolean(),
    indexVersion: z.number().int().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

export type RepositorySnapshotArtifactDto = z.infer<typeof repositorySnapshotArtifactSchema>;
