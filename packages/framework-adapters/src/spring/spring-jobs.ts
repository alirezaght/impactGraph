import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { methodNodesById, SCHEDULED, springAnnotations } from './spring-annotations.js';

import type { CodeGraph } from '../types.js';
import type {
  DecoratorFact,
  FragmentBuilder,
  IndexingContext,
} from '@impactgraph/language-adapters';

// `@Scheduled` → a `job` node with a TRIGGERS edge (PRD §15.2, §12.1/§12.2).
//
// The method is already a `method` node the Java adapter produced; the job is the separate thing
// Spring adds — a timer that invokes it. Keeping them as two nodes joined by TRIGGERS is what lets
// the impact engine say "this scheduled job will change" without claiming the method and the
// schedule are the same entity, and it mirrors how a controller and its route stay distinct.
//
// The schedule EXPRESSION is not modelled. `cron = "0 0 * * * *"` and `fixedDelayString =
// "${app.delay}"` are values §12.1 has no place for, and the second is a property reference this
// adapter would have to resolve to read. The expression stays in the job's evidence, which is
// where a reader can see it verbatim.

export const jobNodeId = (methodNodeId: string): string => `spring:job:${methodNodeId}`;

interface JobInput {
  readonly builder: FragmentBuilder;
  readonly fact: DecoratorFact;
  readonly methodName: string;
  readonly context: IndexingContext;
}

const emitJob = (input: JobInput): void => {
  const { builder, fact, methodName, context } = input;
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  const nodeId = jobNodeId(fact.targetNodeId);
  builder.addNode(
    {
      id: nodeId,
      category: 'application',
      type: 'job',
      name: methodName,
      path: fact.filePath,
      knowledge,
    },
    fact.filePath,
  );
  builder.addEdge(
    {
      id: `spring:triggers:${nodeId}->${fact.targetNodeId}`,
      type: 'TRIGGERS',
      sourceId: nodeId,
      targetId: fact.targetNodeId,
      knowledge,
    },
    fact.filePath,
  );
};

/**
 * Every `@Scheduled` method becomes one job. An annotation on something that is not an indexed
 * method (a type, a field) is reported rather than turned into a job with no target: Spring would
 * reject it too, and a job pointing nowhere is worse than a warning.
 */
export const addScheduledJobs = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const methods = methodNodesById(graph);
  for (const fact of springAnnotations(graph)) {
    if (fact.decoratorName !== SCHEDULED) {
      continue;
    }
    const methodName = methods.get(fact.targetNodeId);
    if (methodName === undefined) {
      builder.warn(fact.filePath, '@Scheduled annotates something that is not an indexed method');
      continue;
    }
    emitJob({ builder, fact, methodName, context });
  }
};
