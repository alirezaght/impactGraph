import {
  evidenceProvenanceOf,
  evidenceStrengthRank,
  evidenceTypesOf,
  isIndependent,
  likelihoodRank,
  planningRoleOf,
  planningRoleRank,
  primaryEvidenceType,
} from '@impactgraph/domain';

import type { ImpactFilters } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImpactEvidenceType,
  KnowledgeGraph,
  NodeId,
  PlanningRole,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

/**
 * Filtering, ranking, and paging of impacts (item 9).
 *
 * Two rules the trials made necessary. Structural findings come first — a page of lexical
 * coincidences above a required structural impact is worse than no ranking at all. And
 * `lexical-only` is EXCLUDED BY DEFAULT: it is a real result an agent can ask for, but it is not
 * what "the impacts of this specification" means.
 */

export interface SelectionResult {
  readonly impacts: readonly RequirementImpact[];
  readonly totalMatching: number;
  readonly nextCursor?: string;
  readonly appliedFilters: ImpactFilters;
}

export const DEFAULT_TOP_N = 20;

/**
 * ADR-0025: the default answer to "what are the impacts of this specification" is the planning
 * decisions, not everything the traversal could reach. The other roles are one filter away and the
 * applied filter is always echoed back, so a caller can never mistake the default for the whole.
 */
export const DEFAULT_ROLES: readonly PlanningRole[] = ['planning-impact'];

const DEFAULTS = {
  topN: DEFAULT_TOP_N,
  minLikelihood: 'possible',
  includeLexicalOnly: false,
  includeExcluded: false,
} as const;

/**
 * Independent discoveries before confirmations and lexical noise — WITHIN a tier and basis, never
 * across them (ADR-0017 §5). An echo of the specification keeps its honest tier, but it no longer
 * outranks an equally-tiered impact the engine actually found. Absent provenance reads as the
 * weakest class, matching `evidenceProvenanceOf`.
 */
const provenanceClassRank = (impact: RequirementImpact): number =>
  isIndependent(evidenceProvenanceOf(impact)) ? 0 : 1;

/**
 * Rank: planning role, then strongest tier, then strongest evidence basis, then provenance class
 * (discovery before confirmation), then confidence, then node id.
 *
 * Role goes FIRST as of ADR-0025, above the tier it used to lead with. The tier answers "how
 * strongly is this implicated"; the role answers "is this a decision", and a `required` name match
 * on a helper is not a decision while a `possible` finding across an event boundary is. Sorting by
 * tier first put the former above the latter in every mixed list.
 *
 * Tier before basis is unchanged and deliberate: within a role a reader acts on "must this change?"
 * first, and the basis explains why. Provenance before confidence is equally deliberate — an echo's
 * confidence is high precisely because the engine matched the name it was given, so confidence must
 * not decide that tie.
 */
export const byStrength = (a: RequirementImpact, b: RequirementImpact): number =>
  planningRoleRank(planningRoleOf(a)) - planningRoleRank(planningRoleOf(b)) ||
  likelihoodRank(a.likelihood) - likelihoodRank(b.likelihood) ||
  evidenceStrengthRank(primaryEvidenceType(evidenceTypesOf(a))) -
    evidenceStrengthRank(primaryEvidenceType(evidenceTypesOf(b))) ||
  provenanceClassRank(a) - provenanceClassRank(b) ||
  b.confidence - a.confidence ||
  a.nodeId.localeCompare(b.nodeId);

const matchesEvidence = (
  impact: RequirementImpact,
  allowed: readonly ImpactEvidenceType[] | undefined,
): boolean =>
  allowed === undefined || evidenceTypesOf(impact).some((type) => allowed.includes(type));

/** The cursor is the node id of the last item returned — stable because the sort is total. */
const afterCursor = (
  impacts: readonly RequirementImpact[],
  cursor: string | undefined,
): readonly RequirementImpact[] => {
  if (cursor === undefined) {
    return impacts;
  }
  const index = impacts.findIndex((impact) => cursorFor(impact) === cursor);
  return index === -1 ? impacts : impacts.slice(index + 1);
};

export const cursorFor = (impact: RequirementImpact): string =>
  `${impact.requirementId}:${impact.nodeId}`;

interface Resolved {
  readonly topN: number;
  readonly ceiling: number;
  readonly includeLexical: boolean;
  readonly includeExcluded: boolean;
  readonly minLikelihood: NonNullable<ImpactFilters['minLikelihood']>;
  readonly roles: readonly PlanningRole[];
}

const keeps = (
  impact: RequirementImpact,
  resolved: Resolved,
  filters: ImpactFilters,
): boolean => {
  if (filters.requirementId !== undefined && impact.requirementId !== filters.requirementId) {
    return false;
  }
  // The two tier-level opt-ins are asks for a NAMED category, so they bypass the role gate the
  // same way they already bypass the min-likelihood ceiling: `includeExcluded: true` means "show
  // me what the non-goals ruled out", and answering it with nothing because those records are
  // filed as context would make the advertised opt-in a lie.
  if (impact.likelihood === 'excluded') {
    return resolved.includeExcluded;
  }
  if (impact.likelihood === 'lexical-only') {
    return resolved.includeLexical && matchesEvidence(impact, filters.evidenceTypes);
  }
  // ADR-0025: everything else is gated on the role first. This is the line that stops "the impacts
  // of this specification" from meaning "everything reachable from anything it mentions".
  if (!resolved.roles.includes(planningRoleOf(impact))) {
    return false;
  }
  return (
    likelihoodRank(impact.likelihood) <= resolved.ceiling &&
    matchesEvidence(impact, filters.evidenceTypes)
  );
};

export const selectImpacts = (
  analysis: ImpactAnalysis,
  filters: ImpactFilters = {},
): SelectionResult => {
  const minLikelihood = filters.minLikelihood ?? DEFAULTS.minLikelihood;
  const resolved: Resolved = {
    topN: filters.topN ?? DEFAULTS.topN,
    ceiling: likelihoodRank(minLikelihood),
    includeLexical: filters.includeLexicalOnly ?? DEFAULTS.includeLexicalOnly,
    includeExcluded: filters.includeExcluded ?? DEFAULTS.includeExcluded,
    minLikelihood,
    roles: filters.roles ?? DEFAULT_ROLES,
  };
  const matching = analysis.requirementImpacts
    .filter((impact) => keeps(impact, resolved, filters))
    .sort(byStrength);
  const remaining = afterCursor(matching, filters.cursor);
  const page = remaining.slice(0, resolved.topN);
  const last = page[page.length - 1];
  return {
    impacts: page,
    totalMatching: matching.length,
    ...(last !== undefined && page.length < remaining.length
      ? { nextCursor: cursorFor(last) }
      : {}),
    appliedFilters: echoFilters(resolved, filters),
  };
};

/**
 * The filters actually applied, echoed back. A caller must be able to see the defaults it did not
 * set — otherwise "20 impacts" is indistinguishable from "20 impacts, 300 withheld".
 */
const echoFilters = (resolved: Resolved, filters: ImpactFilters): ImpactFilters => ({
  topN: resolved.topN,
  minLikelihood: resolved.minLikelihood,
  includeLexicalOnly: resolved.includeLexical,
  includeExcluded: resolved.includeExcluded,
  roles: [...resolved.roles],
  ...(filters.evidenceTypes === undefined ? {} : { evidenceTypes: [...filters.evidenceTypes] }),
  ...(filters.cursor === undefined ? {} : { cursor: filters.cursor }),
  ...(filters.requirementId === undefined ? {} : { requirementId: filters.requirementId }),
  ...(filters.includeFullPaths === undefined
    ? {}
    : { includeFullPaths: filters.includeFullPaths }),
});

/** Impacts sharing a node are one finding for a reader; their requirement ids are collected. */
export interface GroupedImpact {
  readonly impact: RequirementImpact;
  readonly requirementIds: readonly string[];
  readonly requirementLabels: readonly string[];
}

export const groupByNode = (
  impacts: readonly RequirementImpact[],
  specification: Specification,
): readonly GroupedImpact[] => {
  const labelById = new Map(
    specification.requirements.map((requirement) => [requirement.id, requirement.label]),
  );
  const byNode = new Map<string, { impact: RequirementImpact; ids: string[] }>();
  for (const impact of impacts) {
    const existing = byNode.get(impact.nodeId);
    if (existing === undefined) {
      byNode.set(impact.nodeId, { impact, ids: [impact.requirementId] });
      continue;
    }
    existing.ids.push(impact.requirementId);
    if (byStrength(impact, existing.impact) < 0) {
      existing.impact = impact;
    }
  }
  return [...byNode.values()].map((entry) => ({
    impact: entry.impact,
    requirementIds: entry.ids,
    requirementLabels: entry.ids
      .map((id) => labelById.get(id))
      .filter((label): label is string => label !== undefined),
  }));
};

/** Impacts in one role, unfiltered and unpaged — the input to the secondary blocks. */
export const impactsInRole = (
  analysis: ImpactAnalysis,
  role: PlanningRole,
): readonly RequirementImpact[] =>
  analysis.requirementImpacts.filter((impact) => planningRoleOf(impact) === role);

/**
 * Repository paths of everything the analysis predicts — the "predicted area" for warnings.
 *
 * Deliberately still every predictive tier, not just the planning role. This set answers "did the
 * indexer fail to read a file we predict a change in", and an indexing gap under a dependency-
 * context component is just as real a hole in the evidence as one under a planning impact.
 */
export const predictedPathsOf = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    if (impact.likelihood === 'lexical-only' || impact.likelihood === 'excluded') {
      continue;
    }
    const path = graph.nodes.get(impact.nodeId as NodeId)?.path;
    if (path !== undefined) {
      paths.add(path);
    }
  }
  return paths;
};
