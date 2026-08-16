import { z } from 'zod';

import {
  constraintSummarySchema,
  evidenceIndependenceSchema,
  planAssessmentSchema,
  preflightFindingSchema,
  requirementClassificationSchema,
} from '../cli/plan-assessment.js';

// The governance and runtime tools (ADR-0017, ADR-0021). Analysis runs these layers
// unconditionally; the tools exist so a reader can VERIFY a finding — open the rule that blocked a
// plan, walk the path a gap claims, read the full adversarial case behind the bounded summary.

export const GOVERNANCE_TOOL_CONTRACTS = {
  list_constraints: {
    description:
      'List the repository rules ImpactGraph indexed: CI guards, lint boundaries, allowlists and human-declared constraints, with their scope, severity, exemption count and source. `extraction` says how the rule was arrived at — only `recognized` and `declared` constraints can block a plan; `opaque` means a guard exists whose rule could not be read, which is reported rather than hidden.',
    input: z
      .object({
        severity: z.enum(['blocking', 'warning', 'advisory']).optional(),
        kind: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    output: z
      .object({
        constraints: z.array(constraintSummarySchema),
        totalCount: z.number().int().min(0),
        /** Guards seen whose rule was not extracted — the honest limit of this layer. */
        opaqueGuardPaths: z.array(z.string().min(1)),
        guardFilesRead: z.number().int().min(0),
      })
      .strict(),
  },
  list_preflight_findings: {
    description:
      'The explicit red-team view of one analysis: the FULL adversarial finding list the bounded analyze_impact summary sliced to its strongest entries, plus the plan assessment, requirement classifications, evidence independence and what was checked (indexed rule count, unreadable guards). Use it after analyze_impact when the verdict needs its complete justification, or as the "attack the design" deep dive — analysis always red-teams; this tool is where the whole case lives. Defaults to the most recent analysis.',
    input: z
      .object({
        analysisId: z.string().min(1).optional(),
        severity: z.enum(['blocking', 'warning', 'informational']).optional(),
        kind: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        analysisId: z.string().min(1),
        specificationId: z.string().min(1),
        specificationVersion: z.number().int().min(1),
        repositorySnapshotId: z.string().min(1),
        createdAt: z.string().min(1),
        assessment: planAssessmentSchema,
        findings: z.array(preflightFindingSchema),
        totalCount: z.number().int().min(0),
        classifications: z.array(requirementClassificationSchema),
        evidenceIndependence: evidenceIndependenceSchema,
        /** What the adversarial pass actually checked — so "no findings" is auditable. */
        checked: z
          .object({
            analyzers: z.array(z.string().min(1)),
            indexedConstraintCount: z.number().int().min(0),
            opaqueGuardPaths: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
  },
  query_runtime_path: {
    description:
      'Answer "what process actually serves this traffic in production?". Walks the deployment graph from a configured URL through Terraform locals, outputs and variables to the runtime resource, container and handler, and reports the environment variables each process on the path receives. An unresolved chain is reported as unresolved, never completed by guesswork.',
    input: z
      .object({
        /** Matches configured URL or environment-variable names, case-insensitively. */
        urlName: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    output: z
      .object({
        paths: z.array(
          z
            .object({
              id: z.string().min(1),
              hops: z.array(
                z
                  .object({
                    kind: z.string().min(1),
                    nodeId: z.string().min(1),
                    name: z.string().min(1),
                    viaRelation: z.string().min(1).optional(),
                  })
                  .strict(),
              ),
              servingProcess: z.string().min(1).optional(),
              receivedEnvironment: z.array(z.string().min(1)),
              incompleteReason: z.string().min(1).optional(),
            })
            .strict(),
        ),
        totalCount: z.number().int().min(0),
      })
      .strict(),
  },
} as const;
