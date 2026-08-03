import { evaluateChangeRules, evaluateDependencyRules } from '@impactgraph/application';
import { readArchitectureConfig, readRulesConfig } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ArchitectureModel, ArchitectureRule, RuleViolation } from '@impactgraph/application';
import type { KnowledgeGraph } from '@impactgraph/domain';

/** Load `.impactgraph/` project knowledge — rules and human-confirmed assignments (§16). */
export const loadProjectKnowledge = (
  rootDir: string,
): Failable<{ rules: readonly ArchitectureRule[]; architecture: ArchitectureModel }> => {
  const rules = readRulesConfig(rootDir);
  if (!rules.ok) {
    return failWith('configurationError', rules.error.message);
  }
  const architecture = readArchitectureConfig(rootDir);
  if (!architecture.ok) {
    return failWith('configurationError', architecture.error.message);
  }
  return {
    ok: true,
    value: {
      rules: rules.value?.rules ?? [],
      architecture: {
        contexts: architecture.value?.contexts ?? [],
        components: architecture.value?.components ?? [],
      },
    },
  };
};

/** §27 rules evaluated on a review delta (Story 8.4 → Epic 11). */
export const evaluateConfiguredRules = (
  rootDir: string,
  graph: KnowledgeGraph,
  changedFiles: readonly string[],
): Failable<RuleViolation[]> => {
  const knowledge = loadProjectKnowledge(rootDir);
  if (!knowledge.ok) {
    return knowledge;
  }
  if (knowledge.value.rules.length === 0) {
    return { ok: true, value: [] };
  }
  return {
    ok: true,
    value: [
      ...evaluateChangeRules(changedFiles, knowledge.value.rules),
      ...evaluateDependencyRules({
        graph,
        model: knowledge.value.architecture,
        rules: knowledge.value.rules,
        restrictToPaths: new Set(changedFiles),
      }),
    ],
  };
};
