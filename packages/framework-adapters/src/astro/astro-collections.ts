import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// Astro content collections (PRD §15.2). `defineCollection` in `src/content/config.ts` declares
// one; `getCollection('deals')` in a page reads it. Both are call facts the TypeScript adapter
// already recorded, so the collection and the READS_FROM edges come out of the graph rather than
// out of a second parse.

const DEFINE = 'defineCollection';
const READ_CALLS = new Set(['getCollection', 'getEntry', 'getEntryBySlug']);

export const collectionNodeId = (name: string): string => `collection:${name}`;

/**
 * `const deals = defineCollection({…})` names its collection by the variable it is assigned to —
 * that binding is what `export const collections = { deals }` registers, and what a page then
 * passes to `getCollection`. A `defineCollection` call assigned to nothing declares a collection
 * nobody can name, so it is reported rather than given an invented name.
 */
export const addCollections = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): ReadonlySet<string> => {
  const declared = new Set<string>();
  for (const fact of graph.callFacts) {
    if (fact.calleeName !== DEFINE) {
      continue;
    }
    if (fact.assignedTo === undefined) {
      builder.warn(fact.filePath, 'defineCollection() is not assigned to a name — skipped');
      continue;
    }
    emitCollection(builder, fact, fact.assignedTo, context);
    declared.add(fact.assignedTo);
  }
  return declared;
};

const emitCollection = (
  builder: FragmentBuilder,
  fact: CallFact,
  name: string,
  context: IndexingContext,
): void => {
  builder.addNode(
    {
      id: collectionNodeId(name),
      category: 'data',
      type: 'collection',
      name,
      path: fact.filePath,
      knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
    },
    fact.filePath,
  );
};

export interface CollectionReadInput {
  readonly builder: FragmentBuilder;
  readonly graph: CodeGraph;
  readonly declared: ReadonlySet<string>;
  readonly context: IndexingContext;
}

/**
 * `getCollection('deals')` → a READS_FROM edge from the reading component to the collection.
 * A name no `defineCollection` declared is reported, never turned into a node: inventing the
 * collection would manufacture the very fact the edge is supposed to prove.
 */
export const addCollectionReads = ({
  builder,
  graph,
  declared,
  context,
}: CollectionReadInput): void => {
  const componentByPath = new Map(
    graph.nodes
      .filter((node) => node.type === 'ui-component' && node.path !== undefined)
      .map((node) => [String(node.path), String(node.id)]),
  );
  for (const fact of graph.callFacts) {
    const name = fact.stringArguments[0];
    const sourceId = componentByPath.get(fact.filePath);
    if (!READ_CALLS.has(fact.calleeName) || name === undefined || sourceId === undefined) {
      continue;
    }
    if (!declared.has(name)) {
      builder.warn(fact.filePath, `${fact.calleeName}('${name}') names an undeclared collection`);
      continue;
    }
    builder.addEdge(
      {
        id: `astro:reads:${sourceId}->${collectionNodeId(name)}`,
        type: 'READS_FROM',
        sourceId,
        targetId: collectionNodeId(name),
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
      },
      fact.filePath,
    );
  }
};
