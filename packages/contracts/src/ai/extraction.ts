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

// Where the statement came from in the specification (domain REQUIREMENT_ORIGINS). Additive,
// optional: a provider MAY report that a statement is the author's own list item so a structured
// specification is not misread as prose. Absent origins are coerced to 'prose-fallback' — the
// weakest reading — by the application layer; a provider can therefore never inflate a claim by
// omission, only substantiate one by declaring it.
const requirementOriginSchema = z.enum([
  'explicit-label',
  'numbered-item',
  'acceptance-criterion',
  'task-item',
  'bullet-item',
  'prose-modal',
  'prose-fallback',
]);

const extractedRequirementSchema = z
  .object({
    statement: z.string().min(1).max(2000),
    type: requirementTypeSchema,
    concepts: z.array(z.string().min(1).max(200)).max(50),
    actors: z.array(z.string().min(1).max(200)).max(20),
    priority: z.enum(['must', 'should', 'could']).optional(),
    sourceExcerpt: z.string().min(1).max(2000).optional(),
    origin: requirementOriginSchema.optional(),
    /**
     * Additive: how confident the EXTRACTOR is that the statement is a requirement at all.
     * Bounded on receipt — an out-of-range value is a schema failure, never clamped.
     */
    extractionConfidence: z.number().min(0).max(1).optional(),
    /**
     * Additive: which direction the requirement points in. `preserve` marks a regression boundary
     * ("the send job must not change behavior") — a requirement about what the change must NOT
     * break. Absent → `change`, which is the reading every consumer had before the axis existed.
     */
    intent: z.enum(['change', 'preserve']).optional(),
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
