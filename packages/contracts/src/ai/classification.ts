import { z } from 'zod';

// AI response DTO for impact classification (PRD §13.1, §43.5). The model may ONLY reference
// candidates by node id — the schema permits no free-form component definitions, and the
// application layer additionally whitelists ids against the bounded candidate set (§43.2).
// There is deliberately no confidence field: confidence is computed from signals, never
// model-authored (PRD §14).

const likelihoodSchema = z.enum([
  'required',
  'likely',
  'possible',
  'lexical-only',
  'unlikely',
  'excluded',
]);

const impactTypeSchema = z.enum([
  'domain-model',
  'business-rule',
  'api-contract',
  'data-model',
  'migration',
  'event-contract',
  'read-model',
  'background-processing',
  'integration',
  'security',
  'observability',
  'performance',
  'infrastructure',
  'deployment',
  'testing',
  'documentation',
]);

const classificationSchema = z
  .object({
    nodeId: z.string().min(1).max(500),
    likelihood: likelihoodSchema,
    impactType: impactTypeSchema,
    explanation: z.string().min(1).max(2000),
    expectedChanges: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const classificationResponseSchema = z
  .object({
    classifications: z.array(classificationSchema).max(200),
  })
  .strict();

export type ClassificationResponseDto = z.infer<typeof classificationResponseSchema>;
