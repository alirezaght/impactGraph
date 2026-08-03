import { z } from 'zod';

// AI response DTO for requirement extraction (PRD §11.1 types, §40.2). Enforced on receipt in
// packages/ai-inference — model output failing this parse is a provider failure, never a
// lenient parse. The model returns statements and excerpts only; IDs are assigned
// deterministically by the application layer (a model can never mint identifiers).

const requirementTypeSchema = z.enum([
  'functional',
  'business-rule',
  'exception',
  'state-transition',
  'data',
  'integration',
  'security',
  'performance',
  'operational',
  'observability',
  'testing',
  'documentation',
]);

const extractedRequirementSchema = z
  .object({
    statement: z.string().min(1).max(2000),
    type: requirementTypeSchema,
    concepts: z.array(z.string().min(1).max(200)).max(50),
    actors: z.array(z.string().min(1).max(200)).max(20),
    priority: z.enum(['must', 'should', 'could']).optional(),
    sourceExcerpt: z.string().min(1).max(2000).optional(),
  })
  .strict();

const extractedQuestionSchema = z
  .object({
    question: z.string().min(1).max(2000),
    reason: z.string().min(1).max(2000),
    severity: z.enum(['blocking', 'important', 'minor']),
    affectedRequirementStatements: z.array(z.string().min(1).max(2000)).max(20),
  })
  .strict();

export const extractionResponseSchema = z
  .object({
    requirements: z.array(extractedRequirementSchema).max(200),
    actors: z.array(z.string().min(1).max(200)).max(50),
    constraints: z.array(z.string().min(1).max(2000)).max(50),
    openQuestions: z.array(extractedQuestionSchema).max(50),
  })
  .strict();

export type ExtractionResponseDto = z.infer<typeof extractionResponseSchema>;
