import { nonGoalsOf } from '@impactgraph/domain';

import { conceptsOf } from '../analyze-specification/statement-analysis.js';

import { matchConcepts } from './concept-matching.js';

import type {
  AnalysisWarning,
  ImpactLikelihood,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

/**
 * Non-goals act as exclusions, never as positive impacts (item 1).
 *
 * A non-goal names a component precisely to say "do not change this". Feeding it into concept
 * matching as though it were a requirement is the worst possible reading — it produces an impact
 * asserting the opposite of what the author wrote. Here it does the only useful thing instead: it
 * suppresses impacts on components it names, and each suppression is reported so the reader can see
 * the specification ruled the component out rather than the engine missing it.
 *
 * Suppression is a DOWNGRADE to the `excluded` tier, not a deletion: an analysis is append-only,
 * and a reviewer needs to see what was ruled out. A `required` structural impact is deliberately
 * NOT silenced — when the specification says "don't touch the mailer" and the graph says the mailer
 * must change, that is a contradiction worth a blocking warning, not a quiet removal.
 */
export interface NonGoalExclusions {
  /** Node ids the non-goals resolved to, with the non-goal statement that named each. */
  readonly reasonByNodeId: ReadonlyMap<string, string>;
  /**
   * Non-goals that excluded nothing, each paired with the concept that failed to resolve.
   *
   * The CONCEPT, not the statement: reporting "Changing `buildAnalyzeOutput`." as an unresolved
   * concept is wrong twice over — it is not a concept, and it hides which term actually failed. When a
   * non-goal names nothing at all, the statement stands in for the concept and says so.
   */
  readonly unresolved: readonly { concept: string; statement: string }[];
}

export const resolveNonGoals = (
  specification: Specification,
  graph: KnowledgeGraph,
  aliases: Readonly<Record<string, string>> = {},
): NonGoalExclusions => {
  const reasonByNodeId = new Map<string, string>();
  const unresolved: { concept: string; statement: string }[] = [];
  for (const nonGoal of nonGoalsOf(specification.notes)) {
    const concepts = conceptsOf(nonGoal.statement);
    if (concepts.length === 0) {
      // Nothing in the statement is a term, so the statement is all there is to report.
      unresolved.push({ concept: nonGoal.statement, statement: nonGoal.statement });
      continue;
    }
    const matched = matchConcepts(graph, concepts, aliases);
    for (const concept of [...matched.unknownConcepts, ...matched.ambiguousConcepts]) {
      unresolved.push({ concept, statement: nonGoal.statement });
    }
    for (const match of matched.matches) {
      if (!reasonByNodeId.has(match.nodeId)) {
        reasonByNodeId.set(match.nodeId, nonGoal.statement);
      }
    }
  }
  return { reasonByNodeId, unresolved };
};

export interface ExclusionOutcome {
  readonly impacts: readonly RequirementImpact[];
  readonly warnings: readonly AnalysisWarning[];
}

const EXCLUDED: ImpactLikelihood = 'excluded';

export const applyNonGoalExclusions = (
  impacts: readonly RequirementImpact[],
  exclusions: NonGoalExclusions,
): ExclusionOutcome => {
  if (exclusions.reasonByNodeId.size === 0) {
    return { impacts, warnings: [] };
  }
  const warnings: AnalysisWarning[] = [];
  const applied = impacts.map((impact) => {
    const reason = exclusions.reasonByNodeId.get(impact.nodeId);
    if (reason === undefined) {
      return impact;
    }
    if (impact.likelihood === 'required') {
      warnings.push({
        code: 'non-goal-contradiction',
        message: `a non-goal excludes this component ("${reason}") but the analysis found a required structural impact on it — resolve the contradiction before implementing`,
        requirementId: impact.requirementId,
      });
      return impact;
    }
    warnings.push({
      code: 'non-goal-exclusion',
      message: `impact downgraded to 'excluded': a non-goal names this component ("${reason}")`,
      requirementId: impact.requirementId,
    });
    return {
      ...impact,
      likelihood: EXCLUDED,
      explanation: `${impact.explanation} Excluded by a specification non-goal: "${reason}".`,
    };
  });
  return { impacts: applied, warnings };
};
