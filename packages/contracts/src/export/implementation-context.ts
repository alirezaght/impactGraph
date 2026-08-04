import { z } from 'zod';

import { architectureRuleSchema } from '../config/rules-config.js';

// PRD §22 — the implementation context handed to coding agents, as JSON/Markdown/tool response.
// The embedded specification and analysis are the domain-serialized artifact documents (each
// schema-versioned and fully validated by the domain parsers); here they are checked
// structurally so this schema does not duplicate the domain serialization format.

const embeddedArtifactSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    id: z.string().min(1),
  })
  .passthrough();

const impactSummarySchema = z
  .object({
    requirementId: z.string().min(1),
    nodeId: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    likelihood: z.enum(['required', 'likely', 'possible', 'lexical-only', 'unlikely', 'excluded']),
    impactType: z.string().min(1),
    directness: z.enum(['direct', 'indirect']),
    confidence: z.number().min(0).max(1),
    explanation: z.string().min(1),
    expectedChanges: z.array(z.string()),
    dependencyPath: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();

const expectationSchema = z
  .object({
    name: z.string().min(1),
    reason: z.string().min(1),
    nodeId: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
  })
  .strict();

const reviewCriterionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['required-impact', 'architecture-rule']),
    description: z.string().min(1),
    nodeId: z.string().min(1).optional(),
    ruleId: z.string().min(1).optional(),
  })
  .strict();

const snapshotSummarySchema = z
  .object({
    id: z.string().min(1),
    branch: z.string().optional(),
    commitSha: z.string().min(1),
    dirtyWorkingTree: z.boolean(),
    createdAt: z.string().min(1),
  })
  .strict();

const analysisWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    requirementId: z.string().min(1).optional(),
  })
  .strict();

export const implementationContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    specification: embeddedArtifactSchema,
    approvedAnalysis: embeddedArtifactSchema,
    repositorySnapshot: snapshotSummarySchema,
    requiredImpacts: z.array(impactSummarySchema),
    likelyImpacts: z.array(impactSummarySchema),
    rejectedImpacts: z.array(impactSummarySchema),
    architectureConstraints: z.array(architectureRuleSchema),
    expectedTests: z.array(expectationSchema),
    expectedMigrations: z.array(expectationSchema),
    expectedInfrastructureChanges: z.array(expectationSchema),
    openWarnings: z.array(analysisWarningSchema),
    reviewCriteria: z.array(reviewCriterionSchema),
  })
  .strict();

export type ImplementationContextDto = z.infer<typeof implementationContextSchema>;
