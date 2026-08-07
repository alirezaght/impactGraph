import { evidenceTypesOf, primaryEvidenceType } from '@impactgraph/domain';

import { attributionPrefixes, componentsByRepository } from '../repository-attribution.js';

import type { CliImpactSummary } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, Requirement, Specification } from '@impactgraph/domain';

// Counting and coverage facts for the bounded summary. Separate from the assembler so both stay
// under the effective-LOC budget and each can be tested on its own.

/** Roster-shaped input for the per-repository dimension (item 6). */
export interface RepositoryAttributionInput {
  readonly graph: KnowledgeGraph;
  /** Roster entries: the workspace root plus every registered repository (`path` = prefix). */
  readonly repositories: readonly { readonly name: string; readonly path?: string | undefined }[];
}

/**
 * Distinct impacted components per repository — "which repositories does this change span".
 * Only computed when more than one repository is registered: for a single-repository workspace
 * the answer is trivially "this one" and printing it would be noise.
 */
const byRepositoryOf = (
  analysis: ImpactAnalysis,
  attribution: RepositoryAttributionInput | undefined,
): Record<string, number> | undefined => {
  if (attribution === undefined || attribution.repositories.length <= 1) {
    return undefined;
  }
  return componentsByRepository(
    analysis.requirementImpacts.map((impact) => impact.nodeId),
    attribution.graph,
    attributionPrefixes(attribution.repositories),
  );
};

export const summaryCounts = (
  analysis: ImpactAnalysis,
  attribution?: RepositoryAttributionInput,
): CliImpactSummary['counts'] => {
  const byLikelihood: Record<string, number> = {};
  const byEvidenceType: Record<string, number> = {};
  const nodes = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    byLikelihood[impact.likelihood] = (byLikelihood[impact.likelihood] ?? 0) + 1;
    const primary = primaryEvidenceType(evidenceTypesOf(impact));
    byEvidenceType[primary] = (byEvidenceType[primary] ?? 0) + 1;
    nodes.add(impact.nodeId);
  }
  const byRepository = byRepositoryOf(analysis, attribution);
  return {
    totalImpacts: analysis.requirementImpacts.length,
    componentCount: nodes.size,
    byLikelihood,
    byEvidenceType,
    ...(byRepository === undefined ? {} : { byRepository }),
  };
};

/**
 * Requirements no STRUCTURAL impact points at.
 *
 * Deliberately stricter than "no impact at all". A requirement whose only finding is a lexical
 * coincidence is not covered by the analysis, and counting it as covered is how the old coverage
 * number stayed high while the result was useless.
 */
export const unmatchedRequirements = (
  specification: Specification,
  analysis: ImpactAnalysis,
): readonly Requirement[] => {
  const covered = new Set(
    analysis.requirementImpacts
      .filter(
        (impact) => impact.likelihood !== 'lexical-only' && impact.likelihood !== 'excluded',
      )
      .map((impact) => impact.requirementId),
  );
  return specification.requirements.filter((requirement) => !covered.has(requirement.id));
};

export interface ConceptResolution {
  readonly totalConceptCount: number;
  readonly unresolvedConceptCount: number;
  readonly unresolvedConceptNames: readonly string[];
}

/**
 * How many of the specification's own requirement concepts resolved to nothing. Distinct concepts,
 * matched against `unknown-concept` warnings — "every central concept is unresolved" is the
 * strongest deterministic evidence that the relevant repositories are simply not indexed.
 */
export const conceptResolution = (
  specification: Specification,
  analysis: ImpactAnalysis,
): ConceptResolution => {
  const byLowercase = new Map<string, string>();
  for (const requirement of specification.requirements) {
    for (const concept of requirement.concepts) {
      byLowercase.set(concept.toLowerCase(), concept);
    }
  }
  const unresolved = new Set<string>();
  for (const warning of analysis.warnings) {
    if (warning.code !== 'unknown-concept') {
      continue;
    }
    const quoted = /'([^']+)'/.exec(warning.message);
    const original = quoted?.[1] === undefined ? undefined : byLowercase.get(quoted[1].toLowerCase());
    if (original !== undefined) {
      unresolved.add(original);
    }
  }
  return {
    totalConceptCount: byLowercase.size,
    unresolvedConceptCount: unresolved.size,
    unresolvedConceptNames: [...unresolved].sort((a, b) => a.localeCompare(b)),
  };
};

const UNRESOLVED_LIMIT = 25;

/**
 * Specification terms that resolved to no indexed artifact (item 2). These are the honest form of
 * the nodes the old pipeline would have invented: reported as unresolved, with the requirement that
 * mentioned them, and never turned into graph entities.
 */
export const unresolvedConcepts = (
  analysis: ImpactAnalysis,
): CliImpactSummary['unresolvedConcepts'] => {
  const seen = new Set<string>();
  const concepts: CliImpactSummary['unresolvedConcepts'] = [];
  for (const warning of analysis.warnings) {
    if (warning.code !== 'unresolved-concept' || concepts.length >= UNRESOLVED_LIMIT) {
      continue;
    }
    const quoted = /'([^']+)'|"([^"]+)"/.exec(warning.message);
    const concept = quoted?.[1] ?? quoted?.[2] ?? warning.message.slice(0, 60);
    if (seen.has(concept)) {
      continue;
    }
    seen.add(concept);
    concepts.push({
      concept,
      ...(warning.requirementId === undefined ? {} : { requirementId: warning.requirementId }),
      note: warning.message,
    });
  }
  return concepts;
};
