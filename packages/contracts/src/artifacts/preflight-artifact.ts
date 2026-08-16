import { z } from 'zod';

import {
  evidenceIndependenceSchema,
  planAssessmentSchema,
  preflightFindingSchema,
  requirementClassificationSchema,
} from '../cli/plan-assessment.js';

/**
 * Persisted adversarial-preflight outcome (ADR-0017), one artifact per analysis run.
 *
 * A separate artifact rather than a field on the analysis: the analysis store's append-only rules
 * ("content is immutable — only status and appended decisions may change") stay untouched, and the
 * findings remain retrievable after approval freezes the analysis. Frozen at write time; a re-run
 * analysis gets a new analysis id and therefore a new artifact — findings are never rewritten.
 *
 * `planContract` is the slice review consumes (spec R18): what the approved plan committed to, in
 * terms a diff can be checked against, so post-implementation review inherits the preflight's
 * knowledge instead of re-deriving a weaker version from impacts alone.
 */

export const preflightPlanContractSchema = z
  .object({
    /** Configuration names the plan said must propagate to the serving processes. */
    requiredConfigNames: z.array(z.string().min(1)),
    /** Runtime process node ids the plan said were on the request path. */
    runtimeProcessNodeIds: z.array(z.string().min(1)),
    /** Ids of the repository constraints that governed the plan at analysis time. */
    constraintIds: z.array(z.string().min(1)),
  })
  .strict();

export const preflightArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    analysisId: z.string().min(1),
    specificationId: z.string().min(1),
    specificationVersion: z.number().int().min(1),
    repositorySnapshotId: z.string().min(1),
    createdAt: z.string().min(1),
    assessment: planAssessmentSchema,
    /** The FULL finding list, strongest first — the analyze summary carries a bounded slice. */
    findings: z.array(preflightFindingSchema),
    classifications: z.array(requirementClassificationSchema),
    evidenceIndependence: evidenceIndependenceSchema,
    constraintCoverage: z
      .object({
        indexedConstraintCount: z.number().int().min(0),
        opaqueGuardPaths: z.array(z.string().min(1)),
      })
      .strict(),
    planContract: preflightPlanContractSchema,
  })
  .strict();

export type PreflightPlanContractDto = z.infer<typeof preflightPlanContractSchema>;
export type PreflightArtifactDto = z.infer<typeof preflightArtifactSchema>;
