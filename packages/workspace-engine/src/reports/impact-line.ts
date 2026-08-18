import {
  evidenceTypesOf,
  planningRoleVerdictOf,
  primaryEvidenceType,
  provenanceLabel,
} from '@impactgraph/domain';

import type { GroupedImpact } from './impact-selection.js';
import type { CliImpactSummary } from '@impactgraph/contracts';
import type { KnowledgeGraph, NodeId, RequirementImpact } from '@impactgraph/domain';

/**
 * One impact as a summary line, and the classification axes every surface repeats.
 *
 * Shared by the bounded summary and the paginated detail page so the two can never label the same
 * record differently — the failure this file exists to prevent is a reader seeing an impact called
 * a planning decision in one tool and a lead in another.
 */

/**
 * `planningRole` is always present: it re-derives when a stored analysis predates the axis, because
 * every input the derivation reads is on the record. `evidenceProvenance` never defaults — absence
 * there must not read as "independently discovered" (ADR-0017 §5) — so the field simply stays away.
 */
export const classificationFields = (
  impact: RequirementImpact,
): Pick<
  CliImpactSummary['topImpacts'][number],
  'planningRole' | 'planningRoleRule' | 'planningRoleReason' | 'evidenceProvenance' | 'provenanceLabel'
> => {
  const verdict = planningRoleVerdictOf(impact);
  return {
    planningRole: verdict.role,
    planningRoleRule: verdict.rule,
    planningRoleReason: verdict.reason,
    ...(impact.evidenceProvenance === undefined
      ? {}
      : {
          evidenceProvenance: impact.evidenceProvenance,
          provenanceLabel: provenanceLabel(impact.evidenceProvenance),
        }),
  };
};

export const impactLine = (
  grouped: GroupedImpact,
  graph: KnowledgeGraph,
  includeFullPaths: boolean,
): CliImpactSummary['topImpacts'][number] => {
  const { impact } = grouped;
  const node = graph.nodes.get(impact.nodeId as NodeId);
  const evidenceTypes = evidenceTypesOf(impact);
  return {
    nodeId: impact.nodeId,
    name: node?.name ?? impact.nodeId,
    ...(node?.path === undefined || !includeFullPaths ? {} : { path: node.path }),
    likelihood: impact.likelihood,
    evidenceType: primaryEvidenceType(evidenceTypes),
    impactType: impact.impactType,
    confidence: impact.confidence,
    hops: Math.max(0, impact.dependencyPath.length - 1),
    requirementIds: [...new Set(grouped.requirementIds)].sort(),
    requirementLabels: [...new Set(grouped.requirementLabels)].sort(),
    reason: impact.explanation,
    ...(impact.tierCappedBy === undefined ? {} : { tierCappedBy: impact.tierCappedBy }),
    // ADR-0025: the role and the rule that produced it ride with every line, so a reader who
    // disagrees with the classification can see which rule to argue with.
    ...classificationFields(impact),
  };
};

