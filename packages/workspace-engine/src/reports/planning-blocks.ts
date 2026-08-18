import {
  isPrimarySurface,
  planningRoleOf,
  summarisePlanningRoles,
  unresolvedSurfaceLabel,
} from '@impactgraph/domain';

import { impactsInRole } from './impact-selection.js';

import type {
  DependencyContextDto,
  PlanningSignalDto,
  UnresolvedSurfaceDto,
} from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, NodeId } from '@impactgraph/domain';

/**
 * The secondary halves of the analyze document (ADR-0025).
 *
 * The rule these blocks exist to enforce: nothing the analysis found is thrown away, and nothing
 * that is not a decision is shown first. Dependency context is reported as counts and entry points
 * rather than as a second list of rows, because a reader deciding whether to look does not need
 * the rows — and a reader who does need them pages `list_impacts` with the role filter, which is
 * named in the block itself so nobody has to guess.
 */

const MAX_REACHED_FROM = 5;

export const buildPlanningSignal = (analysis: ImpactAnalysis): PlanningSignalDto =>
  summarisePlanningRoles(analysis.requirementImpacts.map(planningRoleOf));

/**
 * Which planning impacts the context hangs off. Read from `dependencyPath[0]` — the anchor a route
 * started at — so the answer is "these are the components whose neighbourhood this is", not a
 * ranking of the context itself.
 */
const reachedFrom = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): readonly string[] => {
  const counts = new Map<string, number>();
  for (const impact of impactsInRole(analysis, 'dependency-context')) {
    const anchor = impact.dependencyPath[0];
    if (anchor === undefined || anchor === impact.nodeId) {
      continue;
    }
    const name = graph.nodes.get(anchor as NodeId)?.name ?? anchor;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REACHED_FROM)
    .map(([name, count]) => `${name} (${String(count)})`);
};

export const buildDependencyContext = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): DependencyContextDto | undefined => {
  const context = impactsInRole(analysis, 'dependency-context');
  const leads = impactsInRole(analysis, 'investigation-lead');
  if (context.length === 0 && leads.length === 0) {
    return undefined;
  }
  const byImpactType: Record<string, number> = {};
  for (const impact of context) {
    byImpactType[impact.impactType] = (byImpactType[impact.impactType] ?? 0) + 1;
  }
  return {
    componentCount: new Set(context.map((impact) => impact.nodeId)).size,
    investigationLeadCount: new Set(leads.map((impact) => impact.nodeId)).size,
    byImpactType,
    reachedFrom: [...reachedFrom(analysis, graph)],
    howToInspect:
      "list_impacts with roles: ['dependency-context'] (or ['investigation-lead']) returns these rows with their dependency paths and confidence signals; explain_node explains any one of them.",
  };
};

/**
 * The unresolved surfaces, primary ones first. Every surface is emitted — the ordering is what
 * changes, because a route the specification committed to and a prose word that happened not to
 * resolve are not the same kind of finding.
 */
export const buildUnresolvedSurfaces = (
  analysis: ImpactAnalysis,
): UnresolvedSurfaceDto[] | undefined => {
  const surfaces = analysis.unresolvedSurfaces;
  if (surfaces === undefined || surfaces.length === 0) {
    return undefined;
  }
  return [...surfaces]
    .sort(
      (a, b) =>
        Number(isPrimarySurface(b)) - Number(isPrimarySurface(a)) ||
        b.confidence - a.confidence ||
        a.concept.localeCompare(b.concept),
    )
    .map((surface) => ({
      concept: surface.concept,
      shape: surface.shape,
      kind: surface.kind,
      alternativeKinds: [...surface.alternativeKinds],
      rationale: surface.rationale,
      requirementIds: [...surface.requirementIds],
      nearestExisting: [...surface.nearestExisting],
      confidence: surface.confidence,
      label: unresolvedSurfaceLabel(surface),
    }));
};
