import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// Pydantic models and background tasks (PRD §15.2). Both are convention-derived facts backed by
// evidence the Python adapter recorded — a base-class reference and a call site respectively.

const PYDANTIC_BASES = new Set(['BaseModel', 'BaseSettings']);

/**
 * A class whose declared base is a Pydantic model base becomes a `schema` data node alongside its
 * class node. The base itself lives in site-packages, so assembly cannot turn the reference into
 * an EXTENDS edge — the raw reference is what proves the fact.
 */
export const addPydanticModels = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  if (graph.symbolReferences === undefined) {
    builder.warn(
      'fastapi',
      'class-base facts were not supplied to the framework stage — Pydantic models not enriched',
    );
    return;
  }
  const classNodes = new Map(
    graph.nodes.filter((node) => node.type === 'class').map((node) => [String(node.id), node]),
  );
  for (const reference of graph.symbolReferences) {
    const classNode = classNodes.get(reference.fromSymbolNodeId);
    if (reference.kind !== 'extends' || classNode === undefined) {
      continue;
    }
    if (!PYDANTIC_BASES.has(reference.targetName)) {
      continue;
    }
    const knowledge = deterministicEnvelope(
      context,
      [reference.evidenceId],
      'framework-convention',
    );
    const schemaNodeId = `schema:${reference.fromSymbolNodeId}`;
    builder.addNode(
      {
        id: schemaNodeId,
        category: 'data',
        type: 'schema',
        name: classNode.name,
        path: reference.filePath,
        knowledge,
      },
      reference.filePath,
    );
    builder.addEdge(
      {
        id: `fastapi:contains:${reference.fromSymbolNodeId}->${schemaNodeId}`,
        type: 'CONTAINS',
        sourceId: reference.fromSymbolNodeId,
        targetId: schemaNodeId,
        knowledge,
      },
      reference.filePath,
    );
  }
};

/**
 * `background_tasks.add_task(fn, …)` inside an endpoint → a `job` node, triggered by the endpoint
 * and triggering the target function. Unresolvable targets are reported, never guessed.
 */
export const addBackgroundTasks = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  for (const fact of graph.callFacts) {
    const target = fact.identifierArguments[0];
    if (fact.calleeName !== 'add_task' || target === undefined) {
      continue;
    }
    const targetNodeId = graph.resolveSymbol(fact.filePath, target);
    if (targetNodeId === undefined) {
      builder.warn(fact.filePath, `background task '${target}' could not be resolved — skipped`);
      continue;
    }
    emitJob(builder, { fact, targetNodeId, context });
  }
};

interface JobInput {
  readonly fact: CodeGraph['callFacts'][number];
  readonly targetNodeId: string;
  readonly context: IndexingContext;
}

const emitJob = (builder: FragmentBuilder, { fact, targetNodeId, context }: JobInput): void => {
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  const jobNodeId = `job:${targetNodeId}`;
  builder.addNode(
    {
      id: jobNodeId,
      category: 'application',
      type: 'job',
      name: `background task ${targetNodeId.slice(targetNodeId.lastIndexOf('#') + 1)}`,
      path: fact.filePath,
      knowledge,
    },
    fact.filePath,
  );
  builder.addEdge(
    {
      id: `fastapi:triggers:${jobNodeId}->${targetNodeId}`,
      type: 'TRIGGERS',
      sourceId: jobNodeId,
      targetId: targetNodeId,
      knowledge,
    },
    fact.filePath,
  );
  if (fact.enclosingSymbolNodeId !== undefined) {
    builder.addEdge(
      {
        id: `fastapi:triggers:${fact.enclosingSymbolNodeId}->${jobNodeId}`,
        type: 'TRIGGERS',
        sourceId: fact.enclosingSymbolNodeId,
        targetId: jobNodeId,
        knowledge,
      },
      fact.filePath,
    );
  }
};
