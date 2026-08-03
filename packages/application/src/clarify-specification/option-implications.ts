import type { KnowledgeGraph, NodeId, OptionImplications } from '@impactgraph/domain';

// Story 6.6 (§26) — the implications of choosing an option, derived from its graph footprint.
// Deliberately deterministic: the model proposes the READING, the engine states the
// CONSEQUENCES from facts. A model is never asked "is this risky?" — the footprint answers.

interface FootprintFacts {
  readonly names: readonly string[];
  readonly dataNames: readonly string[];
  readonly migrationNames: readonly string[];
  readonly apiNames: readonly string[];
  readonly eventNames: readonly string[];
  readonly infraNames: readonly string[];
  readonly testNames: readonly string[];
}

const API_TYPES = new Set(['api-endpoint', 'controller', 'handler', 'route']);
const EVENT_TYPES = new Set(['topic', 'subscription', 'domain-event', 'queue']);

const collect = (graph: KnowledgeGraph, footprint: ReadonlySet<string>): FootprintFacts => {
  const names: string[] = [];
  const dataNames: string[] = [];
  const migrationNames: string[] = [];
  const apiNames: string[] = [];
  const eventNames: string[] = [];
  const infraNames: string[] = [];
  const testNames: string[] = [];
  for (const id of [...footprint].sort((a, b) => a.localeCompare(b))) {
    const node = graph.nodes.get(id as NodeId);
    if (node === undefined) {
      continue;
    }
    names.push(node.name);
    if (node.type === 'migration') {
      migrationNames.push(node.name);
    } else if (node.category === 'data') {
      dataNames.push(node.name);
    }
    if (API_TYPES.has(node.type)) {
      apiNames.push(node.name);
    }
    if (EVENT_TYPES.has(node.type) || node.category === 'integration') {
      eventNames.push(node.name);
    }
    if (node.category === 'infrastructure') {
      infraNames.push(node.name);
    }
    if (node.type === 'test') {
      testNames.push(node.name);
    }
  }
  return { names, dataNames, migrationNames, apiNames, eventNames, infraNames, testNames };
};

const listOf = (subject: string, names: readonly string[]): string[] =>
  names.length === 0 ? [] : [`${subject}: ${[...new Set(names)].slice(0, 5).join(', ')}`];

const complexityOf = (facts: FootprintFacts): OptionImplications['complexity'] => {
  const weight =
    facts.names.length +
    facts.dataNames.length * 2 +
    facts.migrationNames.length * 3 +
    facts.eventNames.length * 2 +
    facts.infraNames.length * 2;
  if (weight >= 15) {
    return 'high';
  }
  return weight >= 6 ? 'medium' : 'low';
};

const risksOf = (facts: FootprintFacts): string[] => {
  const risks: string[] = [];
  if (facts.migrationNames.length > 0) {
    risks.push('touches migrations — existing records need a backfill decision');
  } else if (facts.dataNames.length > 0) {
    risks.push('changes data the repository already stores — verify whether a migration is needed');
  }
  if (facts.eventNames.length > 0) {
    risks.push('crosses an event boundary — consumers change independently of this deployment');
  }
  if (facts.apiNames.length > 0) {
    risks.push('changes an exposed API surface — existing callers may break');
  }
  if (facts.infraNames.length > 0) {
    risks.push('requires infrastructure changes — deployment is not code-only');
  }
  if (facts.testNames.length === 0 && facts.names.length > 0) {
    risks.push('no test node in the footprint — the change would land unverified');
  }
  return risks;
};

/** §26: derive what choosing this interpretation implies from the nodes it would affect. */
export const optionImplications = (
  graph: KnowledgeGraph,
  footprint: ReadonlySet<string>,
): OptionImplications => {
  const facts = collect(graph, footprint);
  return {
    affectedComponentCount: facts.names.length,
    dataChanges: [
      ...listOf('data models affected', facts.dataNames),
      ...listOf('migrations involved', facts.migrationNames),
    ],
    contractChanges: [
      ...listOf('API surfaces affected', facts.apiNames),
      ...listOf('event contracts affected', facts.eventNames),
    ],
    infrastructureChanges: listOf('infrastructure affected', facts.infraNames),
    testingImpact: listOf('existing tests covering the footprint', facts.testNames),
    complexity: complexityOf(facts),
    risks: risksOf(facts),
  };
};
