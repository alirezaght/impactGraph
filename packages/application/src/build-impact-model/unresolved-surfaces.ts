import { classifyUnresolvedSurface } from '@impactgraph/domain';

import {
  indexedTypes,
  referencesExternalBoundary,
  siblingSurfaceIndexed,
  usesCreationLanguage,
} from '../analyze-specification/requirement-language.js';
import { isSpeculativeConcept } from '../analyze-specification/statement-analysis.js';

import type { ConceptMatchResult } from './concept-matching.js';
import type { KnowledgeGraph, Requirement, UnresolvedSurface } from '@impactgraph/domain';

/**
 * Turn "this concept matched nothing" into a finding with a reading (ADR-0025).
 *
 * Before this, an unresolved concept was a warning string, and warnings are the part of an output
 * nobody reads. That is exactly backwards for the case that matters: when a specification
 * introduces `/threshold-eval/export` and no such surface exists, the ABSENCE is the most valuable
 * thing the analysis found — it is the work — while the artifacts whose names happen to share a
 * word with it are the least valuable.
 */

export interface UnresolvedSurfaceInput {
  readonly graph: KnowledgeGraph;
  readonly requirements: readonly Requirement[];
  /** Per requirement id, the match result the concept pass produced for it. */
  readonly matchesByRequirement: ReadonlyMap<string, ConceptMatchResult>;
  /**
   * Registered, enabled repositories absent from the current index. The SAME roster fact the
   * coverage verdict reads, so a surface can never be called new construction by one surface while
   * another says the repository holding it was never indexed.
   */
  readonly missingRepositoryCount: number;
}

interface Accumulated {
  readonly requirementIds: Set<string>;
  readonly nearestExisting: Set<string>;
  usesCreationLanguage: boolean;
  referencesExternalBoundary: boolean;
  siblingSurfaceIndexed: boolean;
}

const accumulate = (byConcept: Map<string, Accumulated>, concept: string): Accumulated => {
  const existing = byConcept.get(concept);
  if (existing !== undefined) {
    return existing;
  }
  const fresh: Accumulated = {
    requirementIds: new Set(),
    nearestExisting: new Set(),
    usesCreationLanguage: false,
    referencesExternalBoundary: false,
    siblingSurfaceIndexed: false,
  };
  byConcept.set(concept, fresh);
  return fresh;
};

/**
 * A concept can be named by several requirements, and the readings differ per statement. The
 * signals are OR-ed: one requirement saying "add /threshold-eval/export" is enough to make the
 * surface new construction, even if another merely references it.
 */
export const collectUnresolvedSurfaces = (
  input: UnresolvedSurfaceInput,
): readonly UnresolvedSurface[] => {
  const types = indexedTypes(input.graph);
  const byConcept = new Map<string, Accumulated>();
  for (const requirement of input.requirements) {
    const matched = input.matchesByRequirement.get(requirement.id);
    if (matched === undefined) {
      continue;
    }
    for (const concept of matched.unknownConcepts) {
      // The same gate `recordMatchWarnings` applies, and for the same reason: a speculative
      // concept was MINED out of prose, not asserted by the author. Reporting "first-class",
      // "opt-in" and "fail-closed" as absent surfaces would drown the identifiers that were
      // actually written — a live run produced 37 surfaces of which 19 were adjectives.
      if (isSpeculativeConcept(concept)) {
        continue;
      }
      const entry = accumulate(byConcept, concept);
      entry.requirementIds.add(requirement.id);
      entry.usesCreationLanguage ||= usesCreationLanguage(requirement.statement);
      entry.referencesExternalBoundary ||= referencesExternalBoundary(requirement.statement);
      entry.siblingSurfaceIndexed ||= siblingSurfaceIndexed(requirement.statement, types);
      for (const near of matched.nearMisses.get(concept) ?? []) {
        entry.nearestExisting.add(near);
      }
    }
  }
  return [...byConcept.entries()]
    .map(([concept, entry]) =>
      classifyUnresolvedSurface({
        concept,
        requirementIds: [...entry.requirementIds].sort(),
        usesCreationLanguage: entry.usesCreationLanguage,
        referencesExternalBoundary: entry.referencesExternalBoundary,
        withinCoverageGap: input.missingRepositoryCount > 0,
        siblingSurfaceIndexed: entry.siblingSurfaceIndexed,
        nearestExisting: [...entry.nearestExisting].sort(),
      }),
    )
    .sort((a, b) => a.concept.localeCompare(b.concept));
};
