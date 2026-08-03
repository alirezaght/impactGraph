import { z } from 'zod';

// Persisted-artifact building blocks shared by graph records (docs/engineering/data-contracts.md).
// These are standalone DTO schemas — the domain vocabulary (node/edge type rosters, signal
// semantics, category/type pairing) is validated by packages/domain at the adapter; the schema
// gate here enforces shape, versions, and the provenance enum (stable, PRD §12.3).

export const provenanceSchema = z.enum([
  'static-analysis',
  'configuration',
  'human-confirmed',
  'llm-inferred',
  'git-history',
  'framework-convention',
  'runtime-observation',
]);

export const confidenceSignalSchema = z
  .object({
    type: z.string().min(1),
    contribution: z.number(),
    description: z.string().max(1000).optional(),
  })
  .strict();

export const confidenceSchema = z
  .object({
    value: z.number().min(0).max(1),
    signals: z.array(confidenceSignalSchema).min(1),
  })
  .strict();

export const specificationRefSchema = z
  .object({
    specificationId: z.string().min(1),
    specificationVersion: z.number().int().min(1),
  })
  .strict();

export const knowledgeEnvelopeSchema = z
  .object({
    provenance: provenanceSchema,
    evidenceIds: z.array(z.string().min(1)),
    confidence: confidenceSchema,
    createdAt: z.string().min(1),
    repositorySnapshotId: z.string().min(1),
    analysisRunId: z.string().min(1),
    specification: specificationRefSchema.optional(),
  })
  .strict();

export type ProvenanceDto = z.infer<typeof provenanceSchema>;
export type KnowledgeEnvelopeDto = z.infer<typeof knowledgeEnvelopeSchema>;
