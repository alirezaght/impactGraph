import { z } from 'zod';

/**
 * The decision-oriented result of a preflight analysis (ADR-0017).
 *
 * `readiness: 87` stays available, but it stops being the headline. A single number invites the
 * reading "87 is pretty good, ship it" precisely when the missing 13 is a hard architectural
 * violation, so the verdict is stated in words and the number rides along beneath it.
 *
 * Every field here is additive to the v1 analyze document: absent means "this analysis did not run
 * the preflight pass", never "nothing was found".
 */

export const FEASIBILITY_VALUES = [
  'READY',
  'READY_WITH_WARNINGS',
  /** ADR-0023: something the specification assumes could not be established. Not a contradiction. */
  'NEEDS_VERIFICATION',
  'NEEDS_CLARIFICATION',
  'INSUFFICIENT_COVERAGE',
  'BLOCKED',
] as const;

export const PREFLIGHT_FINDING_KIND_VALUES = [
  'blocking-constraint-violation',
  'constraint-warning',
  'runtime-topology-gap',
  'invalid-assumption',
  'config-semantics-risk',
  'new-surface',
  'coverage-gap',
  'unresolved-architectural-question',
  'missing-consumer',
  'guard-not-updated',
  /** ADR-0020 §4 — SQL comparing a type-sensitive column against bound parameters. Never blocking. */
  'type-sensitive-comparison',
] as const;

export const UNMATCHED_CLASS_VALUES = [
  'NEW_SURFACE',
  'COVERAGE_GAP',
  'INVALID_ASSUMPTION',
  'AMBIGUOUS',
  'NO_EVIDENCE',
  'EXTERNAL_DEPENDENCY',
] as const;

export const EVIDENCE_PROVENANCE_VALUES = [
  'USER_SUPPLIED',
  'INDEPENDENTLY_DISCOVERED',
  'STRUCTURALLY_INFERRED',
  'CONSTRAINT_DERIVED',
  'RUNTIME_DERIVED',
  'TRANSITIVE',
  'WEAK_LEXICAL',
] as const;

export const preflightFindingSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(PREFLIGHT_FINDING_KIND_VALUES),
    severity: z.enum(['blocking', 'warning', 'informational']),
    requirementIds: z.array(z.string().min(1)),
    statement: z.string().min(1),
    recommendation: z.string().min(1),
    confidence: z.number().min(0).max(1),
    /** The analyzer that produced it, so a false positive traces to one place. */
    analyzer: z.string().min(1),
    /**
     * ADR-0023 additive fields. `verification` says how well established the finding is — only a
     * `verified-contradiction` may ever be blocking. `origin` says whose problem it is: a caveat
     * about ImpactGraph's own reach is not evidence against the plan. Absent on producers that
     * predate the axes, where absence reads as unverified/plan-finding.
     */
    verification: z.enum(['verified-contradiction', 'unverified-assumption']).optional(),
    origin: z.enum(['plan-finding', 'analysis-caveat', 'background-condition']).optional(),
    constraintId: z.string().min(1).optional(),
    proposedRelationship: z
      .object({
        sourceRef: z.string().min(1),
        relation: z.string().min(1),
        targetRef: z.string().min(1),
      })
      .strict()
      .optional(),
    runtimePathId: z.string().min(1).optional(),
    assumedSymbol: z.string().min(1).optional(),
    nodeIds: z.array(z.string().min(1)).optional(),
    filePaths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const planAssessmentSchema = z
  .object({
    feasibility: z.enum(FEASIBILITY_VALUES),
    /** One sentence a reader can act on without opening anything else. */
    decision: z.string().min(1),
    counts: z
      .object({
        blockingViolations: z.number().int().min(0),
        invalidAssumptions: z.number().int().min(0),
        runtimeTopologyGaps: z.number().int().min(0),
        configSemanticsRisks: z.number().int().min(0),
        newSurfaces: z.number().int().min(0),
        coverageGaps: z.number().int().min(0),
        unresolvedArchitecturalQuestions: z.number().int().min(0),
        constraintWarnings: z.number().int().min(0),
        missingConsumers: z.number().int().min(0),
        /** ADR-0020 §4 — additive: absent on assessments produced before the analyzer existed. */
        typeSensitiveComparisons: z.number().int().min(0).optional(),
        expectedChangeSurfaces: z.number().int().min(0),
        /** ADR-0023 additive: assumptions that could not be established, which never block. */
        unverifiedAssumptions: z.number().int().min(0).optional(),
        /** ADR-0023 additive: limits of ImpactGraph's own model — reported, never counted as risk. */
        analysisCaveats: z.number().int().min(0).optional(),
        /** ADR-0023 additive: pre-existing repository conditions the change did not introduce. */
        backgroundConditions: z.number().int().min(0).optional(),
      })
      .strict(),
    decidingFindingIds: z.array(z.string().min(1)),
    /** Secondary on purpose. Withheld, with a reason, when coverage cannot support it. */
    score: z.number().min(0).max(100).optional(),
    scoreWithheldReason: z.string().min(1).optional(),
    /** ADR-0023 additive: set when the verdict forced the question-based score down to its ceiling. */
    scoreCappedReason: z.string().min(1).optional(),
  })
  .strict();

export const requirementClassificationSchema = z
  .object({
    requirementId: z.string().min(1),
    classification: z.enum(UNMATCHED_CLASS_VALUES),
    rationale: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/**
 * How much of the evidence the engine found versus how much the specification handed it.
 *
 * Reported alongside the impacts so a reader can see at a glance whether a confident-looking result
 * is confirmation of what they already wrote.
 */
export const evidenceIndependenceSchema = z
  .object({
    independentCount: z.number().int().min(0),
    confirmationCount: z.number().int().min(0),
    weightedIndependence: z.number().min(0),
    totalCount: z.number().int().min(0),
    /**
     * Additive v1: the honest completeness sentence, composed deterministically in the domain —
     * e.g. "4 of 12 impacts were independently discovered; 5 confirm components the specification
     * itself named; 3 rest on weak lexical or transitive matches." Absent on older producers.
     */
    statement: z.string().min(1).optional(),
  })
  .strict();

export const constraintSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    severity: z.enum(['blocking', 'warning', 'advisory']),
    extraction: z.enum(['recognized', 'declared', 'ai-proposed', 'opaque']),
    statement: z.string().min(1),
    sourcePath: z.string().min(1),
    scopeGlobs: z.array(z.string().min(1)),
    exemptionCount: z.number().int().min(0),
    notExtractedReason: z.string().min(1).optional(),
  })
  .strict();

export type PreflightFindingDto = z.infer<typeof preflightFindingSchema>;
export type PlanAssessmentDto = z.infer<typeof planAssessmentSchema>;
export type RequirementClassificationDto = z.infer<typeof requirementClassificationSchema>;
export type EvidenceIndependenceDto = z.infer<typeof evidenceIndependenceSchema>;
export type ConstraintSummaryDto = z.infer<typeof constraintSummarySchema>;
