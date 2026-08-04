import { z } from 'zod';

import { impactLikelihoodSchema } from './impact-export.js';
import { readinessSchema } from './outputs.js';

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

export const impactEvidenceTypeSchema = z.enum([
  'direct-structural',
  'transitive-structural',
  'async-event',
  'external-contract',
  'field-data-flow',
  'configuration-asset',
  'semantic-match',
  'lexical-only',
]);

export const indexFreshnessSchema = z
  .object({
    state: z.enum([
      'current',
      'working-tree-modified',
      'behind-head',
      'specification-moved',
      'aged',
      'not-indexed',
    ]),
    stale: z.boolean(),
    reasons: z.array(z.string().min(1)),
    indexedSnapshotId: z.string().min(1).optional(),
    indexedAt: z.string().min(1).optional(),
    currentCommitSha: z.string().min(1).optional(),
    recommendedAction: z.string().min(1).optional(),
  })
  .strict();

export const indexWarningReportSchema = z
  .object({
    totalCount: z.number().int().min(0),
    coverageLosingCount: z.number().int().min(0),
    affectsPredictedArea: z.boolean(),
    groups: z.array(
      z
        .object({
          category: z.enum([
            'parse-failure',
            'unsupported-syntax',
            'unresolved-import',
            'unresolved-symbol',
            'ignored-file',
            'missing-generated-file',
            'external-dependency',
            'stale-index',
            'no-adapter',
            'other',
          ]),
          count: z.number().int().min(0),
          examplePaths: z.array(z.string().min(1)),
          exampleMessage: z.string().min(1).optional(),
          affectsPredictedArea: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

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
    counts: z
      .object({
        totalImpacts: z.number().int().min(0),
        componentCount: z.number().int().min(0),
        byLikelihood: z.record(z.number().int().min(0)),
        byEvidenceType: z.record(z.number().int().min(0)),
      })
      .strict(),
    topImpacts: z.array(summaryImpactSchema),
    unmatchedRequirements: z.array(unmatchedRequirementSchema),
    unresolvedConcepts: z.array(unresolvedConceptSchema),
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
    /** How to get the detail this document deliberately withholds. */
    followUp: z.array(z.string().min(1)),
  })
  .strict();

export type CliImpactSummary = z.infer<typeof cliImpactSummarySchema>;
export type ImpactFilters = z.infer<typeof impactFiltersSchema>;

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
    pagination: paginationSchema,
    impactQuery: queryOutcomeSchema,
  })
  .strict();

export type CliImpactPage = z.infer<typeof cliImpactPageSchema>;
