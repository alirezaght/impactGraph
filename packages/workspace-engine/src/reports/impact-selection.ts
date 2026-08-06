import {
  evidenceStrengthRank,
  evidenceTypesOf,
  likelihoodRank,
  primaryEvidenceType,
} from '@impactgraph/domain';

import type { ImpactFilters } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  ImpactEvidenceType,
  KnowledgeGraph,
  NodeId,
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

const DEFAULTS = {
  topN: DEFAULT_TOP_N,
  minLikelihood: 'possible',
  includeLexicalOnly: false,
  includeExcluded: false,
} as const;

/**
 * Rank: strongest tier, then strongest evidence basis, then confidence, then node id.
 *
 * Tier before basis is deliberate. A reader acts on "must this change?" first; the basis explains
 * why. Sorting by basis first would put a `possible` async finding above a `required` structural one.
 */
export const byStrength = (a: RequirementImpact, b: RequirementImpact): number =>
  likelihoodRank(a.likelihood) - likelihoodRank(b.likelihood) ||
  evidenceStrengthRank(primaryEvidenceType(evidenceTypesOf(a))) -
    evidenceStrengthRank(primaryEvidenceType(evidenceTypesOf(b))) ||
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
}

const keeps = (
  impact: RequirementImpact,
  resolved: Resolved,
  filters: ImpactFilters,
): boolean => {
  if (impact.likelihood === 'excluded') {
    return resolved.includeExcluded;
  }
  if (impact.likelihood === 'lexical-only' && !resolved.includeLexical) {
    return false;
  }
  if (filters.requirementId !== undefined && impact.requirementId !== filters.requirementId) {
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

/** Repository paths of everything the analysis predicts — the "predicted area" for warnings. */
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
