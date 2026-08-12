import { z } from 'zod';

import { impactEvidenceTypeSchema } from './evidence-basis.js';
import { impactLikelihoodSchema } from './impact-export.js';
import { indexFreshnessSchema, indexWarningReportSchema } from './index-health.js';
import { readinessSchema } from './outputs.js';
import {
  evidenceIndependenceSchema,
  planAssessmentSchema,
  preflightFindingSchema,
  UNMATCHED_CLASS_VALUES,
} from './plan-assessment.js';

/**
 * The bounded analyze document (item 9: "Default outputs were hundreds of kilobytes and exceeded
 * agent token limits").
 *
 * `analyze_impact` previously returned every impact of every requirement with its full dependency
 * path and evidence file list. On a real repository that is hundreds of kilobytes — an agent cannot
 * read it, so it writes the response to a file and greps, which means the tool's primary output is
 * unusable as an answer. This document is the answer: the status, the caveats, the counts, and the
 * strongest structural findings. Everything else is reachable through `list_impacts`,
 * `get_impact_analysis`, and the HTML export.
 */

export const queryOutcomeSchema = z
  .object({
    status: z.enum([
      'not-run',
      'completed',
      'completed-empty',
      'partial',
      'failed',
      'human-confirmed',
    ]),
    /** What was searched. Required: an unscoped negative result is unfalsifiable (item 11). */
    scope: z.string().min(1),
    limitations: z.array(z.string().min(1)),
    resultCount: z.number().int().min(0),
    reason: z.string().min(1).optional(),
  })
  .strict();

// Moved to ./evidence-basis.js so the full analyze document (`outputs.ts`) can share the
// vocabulary without an import cycle; re-exported here so every existing consumer keeps its
// import path (ADR-0009: one schema, no diverging near-duplicate).
export { impactEvidenceTypeSchema } from './evidence-basis.js';

// Moved to ./index-health.js so the status document can share them; re-exported here so every
// existing consumer keeps its import path (ADR-0009: one schema, no diverging near-duplicate).
export { indexFreshnessSchema, indexWarningReportSchema } from './index-health.js';

export const extractionQualitySchema = z
  .object({
    strategy: z.enum(['structured', 'partially-structured', 'prose-fallback']),
    structuredRequirementCount: z.number().int().min(0),
    proseRequirementCount: z.number().int().min(0),
    recognizedSections: z.array(z.string().min(1)),
    provisional: z.boolean(),
    warnings: z.array(z.string().min(1)),
  })
  .strict();

/** One line per impact: enough to act on, small enough that 20 of them fit in a reply. */
const summaryImpactSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    likelihood: impactLikelihoodSchema,
    /** WHY this impact was selected — the strongest basis (item 3). */
    evidenceType: impactEvidenceTypeSchema,
    impactType: z.string().min(1),
    confidence: z.number().min(0).max(1),
    /** Hops from the component the specification named. 0 = named directly. */
    hops: z.number().int().min(0),
    requirementIds: z.array(z.string().min(1)),
    /** Requirement labels (`R3`) when the author gave them — far more readable than hashes. */
    requirementLabels: z.array(z.string().min(1)),
    reason: z.string().min(1),
    /** Set when the tier was reduced because the evidence did not support the stronger one. */
    tierCappedBy: impactEvidenceTypeSchema.optional(),
  })
  .strict();

const unmatchedRequirementSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    statement: z.string().min(1),
    origin: z.string().min(1),
    /**
     * ADR-0017 — WHY nothing matched. Additive: absent means the preflight pass did not classify
     * this requirement, never that it was classified as ordinary. The distinction it carries is
     * the whole value of the field — "this creates new surface" and "we did not index the code"
     * are opposite planning decisions that used to arrive as the same sentence.
     */
    classification: z.enum(UNMATCHED_CLASS_VALUES).optional(),
    classificationRationale: z.string().min(1).optional(),
  })
  .strict();

const unresolvedConceptSchema = z
  .object({
    concept: z.string().min(1),
    requirementId: z.string().min(1).optional(),
    note: z.string().min(1),
  })
  .strict();

/**
 * Artifact categories a change of this shape usually needs but whose exact path cannot be predicted
 * — a new locale entry, a new test, a new migration (item 8). Predicting a category is honest;
 * predicting `src/locales/de/nda.json` for a file that does not exist yet is not.
 */
const predictedArtifactSchema = z
  .object({
    category: z.enum([
      'new-locale-entry',
      'new-test',
      'new-event-handler',
      'new-migration',
      'new-contract-definition',
      'new-configuration-entry',
    ]),
    reason: z.string().min(1),
    /** Existing artifacts of the same kind, as the place to look. Never invented paths. */
    examplePaths: z.array(z.string().min(1)),
  })
  .strict();

/**
 * A machine-readable next step (item: guided coverage). The agent must never be the one to guess
 * that the graph is incomplete — when ImpactGraph has evidence, it says exactly what to do next.
 */
export const requiredActionSchema = z
  .object({
    action: z.enum([
      'refresh-stale-index',
      'index-registered-repositories',
      'register-missing-repositories',
      'confirm-candidate-repositories',
      'report-limited-scope',
      /** Additive v1: the shown impacts rest on weak evidence — treat them as exploratory. */
      'report-limited-evidence',
    ]),
    reason: z.string().min(1),
    /** Imperative sentence addressed to the coding agent. */
    instruction: z.string().min(1),
    repositories: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Repository-coverage verdict for the analysis. `insufficient-coverage` means the readiness score
 * is withheld: the graph demonstrably does not contain the parts of the system the specification
 * changes, so a normal-looking score would be misleading.
 */
export const workspaceCoverageSchema = z
  .object({
    status: z.enum(['adequate', 'insufficient-coverage']),
    reasons: z.array(z.string().min(1)),
    repositories: z
      .object({
        /** Repositories whose files are in the current index (the workspace root is always one). */
        indexed: z.array(
          z
            .object({
              name: z.string().min(1),
              path: z.string().min(1).optional(),
              fileCount: z.number().int().min(0),
            })
            .strict(),
        ),
        /** Registered and enabled, but absent from disk or from the current index. */
        registeredButMissing: z.array(
          z.object({ name: z.string().min(1), reason: z.string().min(1) }).strict(),
        ),
        /** Discovered but unconfirmed — candidates the user must register; never auto-indexed. */
        candidates: z.array(
          z
            .object({
              name: z.string().min(1),
              path: z.string().min(1),
              hint: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    /** Requirements whose coverage depends on the missing parts (the unmatched set). */
    affectedRequirementIds: z.array(z.string().min(1)),
    /** Concepts that resolved to nothing — likely living in unindexed repositories. */
    affectedConcepts: z.array(z.string().min(1)),
  })
  .strict();

/** Distribution counts over an analysis — shared by the summary and the paginated detail page. */
const impactCountsSchema = z
  .object({
    totalImpacts: z.number().int().min(0),
    componentCount: z.number().int().min(0),
    byLikelihood: z.record(z.number().int().min(0)),
    byEvidenceType: z.record(z.number().int().min(0)),
    /**
     * Additive v1 (item 6): distinct impacted components per registered repository — the plan
     * states which repositories the change spans. Present only when more than one repository is
     * registered; absent otherwise, because "all in this one" is noise for a single repo.
     */
    byRepository: z.record(z.number().int().min(0)).optional(),
  })
  .strict();

/**
 * Additive v1: the aggregate honesty verdict over the impacts this view SHOWS (dogfooding item 4).
 * Deterministic — computed from the tier/basis distribution, never model-authored. When status is
 * 'weak' the analysis is marked provisional and a 'report-limited-evidence' action is emitted.
 */
export const evidenceQualitySchema = z
  .object({
    status: z.enum(['evidence-backed', 'mixed', 'weak']),
    reasons: z.array(z.string().min(1)),
    counts: z
      .object({
        shownImpactCount: z.number().int().min(0),
        strongTierCount: z.number().int().min(0),
        strongTierStructuralCount: z.number().int().min(0),
        fuzzyAnchorCount: z.number().int().min(0),
        multiHopCount: z.number().int().min(0),
        tierCappedCount: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export const impactFiltersSchema = z
  .object({
    topN: z.number().int().min(1).max(500).optional(),
    minLikelihood: impactLikelihoodSchema.optional(),
    evidenceTypes: z.array(impactEvidenceTypeSchema).min(1).optional(),
    includeLexicalOnly: z.boolean().optional(),
    includeExcluded: z.boolean().optional(),
    includeFullPaths: z.boolean().optional(),
    cursor: z.string().min(1).optional(),
    requirementId: z.string().min(1).optional(),
  })
  .strict();

const paginationSchema = z
  .object({
    returned: z.number().int().min(0),
    /** Total matching the filters, BEFORE topN — so a reader knows what was withheld. */
    totalMatching: z.number().int().min(0),
    nextCursor: z.string().min(1).optional(),
    appliedFilters: impactFiltersSchema,
  })
  .strict();

export const cliImpactSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('analyze'),
    analysis: z
      .object({
        id: z.string().min(1),
        snapshotId: z.string().min(1),
        status: z.string().min(1),
        /** True when extraction quality or index freshness makes the result indicative only. */
        provisional: z.boolean(),
        provisionalReasons: z.array(z.string().min(1)),
      })
      .strict(),
    specification: z
      .object({
        id: z.string().min(1),
        version: z.number().int().min(1),
        title: z.string().min(1),
        extractionMode: z.enum(['provider', 'deterministic-fallback', 'unchanged']),
        extractionQuality: extractionQualitySchema.optional(),
        /**
         * Withheld entirely when the extraction is provisional: scoring the implementability of
         * requirements the extractor invented is worse than reporting nothing (item 1).
         */
        readiness: readinessSchema.optional(),
        readinessWithheldReason: z.string().min(1).optional(),
      })
      .strict(),
    freshness: indexFreshnessSchema,
    coverage: z
      .object({
        requirementCount: z.number().int().min(0),
        requirementsWithStructuralImpact: z.number().int().min(0),
        indexWarnings: indexWarningReportSchema,
      })
      .strict(),
    counts: impactCountsSchema,
    /** Additive v1: is the default view evidence-backed, mixed, or weak — with reasons. */
    evidenceQuality: evidenceQualitySchema.optional(),
    topImpacts: z.array(summaryImpactSchema),
    unmatchedRequirements: z.array(unmatchedRequirementSchema),
    unresolvedConcepts: z.array(unresolvedConceptSchema),
    /**
     * ADR-0017 — the decision-oriented headline. Present whenever the preflight pass ran; a
     * consumer that finds it should read it INSTEAD of the readiness score, not alongside.
     */
    planAssessment: planAssessmentSchema.optional(),
    /** The strongest findings, bounded. Full detail via `list_preflight_findings`. */
    preflightFindings: z.array(preflightFindingSchema).optional(),
    /** How much of the evidence was discovered rather than supplied by the specification. */
    evidenceIndependence: evidenceIndependenceSchema.optional(),
    constraintCoverage: z
      .object({
        indexedConstraintCount: z.number().int().min(0),
        opaqueGuardPaths: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    blockingQuestions: z.array(
      z
        .object({
          id: z.string().min(1),
          question: z.string().min(1),
          severity: z.string().min(1),
        })
        .strict(),
    ),
    /** Non-goal contradictions surface here, not buried in `warnings` — they block work. */
    nonGoalContradictions: z.array(z.string().min(1)),
    predictedArtifacts: z.array(predictedArtifactSchema),
    /**
     * §18.4 proposed structure, as COUNTS only. The summary must never merge proposed components
     * into `topImpacts` — current and proposed are diffed, not mixed (§3) — but a reader has to
     * know the proposal exists, so its size is reported and `followUp` says where to read it.
     */
    proposedStructure: z
      .object({
        nodeCount: z.number().int().min(0),
        relationshipCount: z.number().int().min(0),
      })
      .strict()
      .optional(),
    /** Capped and de-duplicated: the important ones, with a count of what was omitted. */
    warnings: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) }).strict()),
    omittedWarningCount: z.number().int().min(0),
    pagination: paginationSchema,
    /** Provenance of the impact query itself (item 11). */
    impactQuery: queryOutcomeSchema,
    /**
     * Additive v1: repository-coverage verdict. When status is 'insufficient-coverage' the
     * readiness score is withheld and `requiredActions` says what to do about it.
     */
    workspaceCoverage: workspaceCoverageSchema.optional(),
    /** Additive v1: machine-readable next steps — the agent follows these, it never guesses. */
    requiredActions: z.array(requiredActionSchema).optional(),
    /** How to get the detail this document deliberately withholds. */
    followUp: z.array(z.string().min(1)),
  })
  .strict();

export type CliImpactSummary = z.infer<typeof cliImpactSummarySchema>;
export type ImpactFilters = z.infer<typeof impactFiltersSchema>;
export type WorkspaceCoverageDto = z.infer<typeof workspaceCoverageSchema>;
export type RequiredActionDto = z.infer<typeof requiredActionSchema>;

/** `list_impacts`: the paginated detail page the summary points at. */
export const cliImpactPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('impacts'),
    analysisId: z.string().min(1),
    impacts: z.array(
      summaryImpactSchema.extend({
        dependencyPath: z.array(z.string().min(1)),
        evidenceTypes: z.array(impactEvidenceTypeSchema),
        evidenceFiles: z.array(z.string()).optional(),
        confidenceSignals: z.array(
          z.object({ type: z.string().min(1), contribution: z.number() }).strict(),
        ),
      }),
    ),
    /**
     * Additive v1: distribution of the WHOLE analysis, so a paged caller can see the aggregate
     * context (how many of the totals are weak or lexical) without fetching every page.
     */
    counts: impactCountsSchema.optional(),
    pagination: paginationSchema,
    impactQuery: queryOutcomeSchema,
  })
  .strict();

export type CliImpactPage = z.infer<typeof cliImpactPageSchema>;
export type EvidenceQualityDto = z.infer<typeof evidenceQualitySchema>;
