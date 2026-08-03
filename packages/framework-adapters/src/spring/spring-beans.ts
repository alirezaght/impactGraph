import { deterministicEnvelope } from '@impactgraph/language-adapters';

import {
  BEAN,
  classNodesById,
  methodNodesById,
  owningClassNodeId,
  springAnnotations,
  STEREOTYPES,
} from './spring-annotations.js';

import type { CodeGraph } from '../types.js';
import type {
  DecoratorFact,
  FragmentBuilder,
  IndexingContext,
} from '@impactgraph/language-adapters';

// Spring stereotypes → role nodes (PRD §15.2). The Java class node is the language fact; the
// role node is Spring's reading of the annotation, so the two stay separate records joined by a
// CONTAINS edge — exactly how the FastAPI adapter attaches a Pydantic `schema` to its class.

/** The role node one annotated class contributes: `controller:<classNodeId>` and friends. */
export const beanNodeId = (nodeType: string, classNodeId: string): string =>
  `spring:${nodeType}:${classNodeId}`;

export interface BeanRole {
  readonly classNodeId: string;
  readonly nodeType: string;
}

/**
 * The role each Spring-annotated class plays. A class carrying two stereotypes (a
 * `@SpringBootApplication` that is also `@Configuration`) yields one role per annotation, each
 * with its own evidence — deduplication is not the adapter's call, the ids differ.
 */
export const addBeanRoles = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): readonly BeanRole[] => {
  const classNames = classNodesById(graph);
  const roles: BeanRole[] = [];
  for (const fact of springAnnotations(graph)) {
    const nodeType = STEREOTYPES[fact.decoratorName];
    const className = classNames.get(fact.targetNodeId);
    if (nodeType === undefined || className === undefined) {
      continue; // not a stereotype, or annotating something that is not a type declaration
    }
    emitRole(builder, { fact, className, nodeType, context });
    roles.push({ classNodeId: fact.targetNodeId, nodeType });
  }
  return roles;
};

/** The bean a `@Bean` factory method declares. */
export const beanFactoryNodeId = (methodNodeId: string): string => `spring:bean:${methodNodeId}`;

/** `@Bean("dealClient")` names the bean; otherwise the method name is the bean name. */
const beanNameOf = (fact: DecoratorFact, qualifiedMethodName: string): string =>
  fact.stringArguments[0] ?? qualifiedMethodName.slice(qualifiedMethodName.lastIndexOf('.') + 1);

/**
 * `@Bean` factory methods (PRD §15.2).
 *
 * The bean is typed `service`: PRD §12.1 has no "bean" type, and a factory method can return
 * anything, so `service` is the closest honest reading of "an application-level collaborator the
 * container owns". Its declared TYPE is not modelled — that is the method's return type, which the
 * Java adapter does not report and which this adapter will not infer.
 *
 * Only methods of a class that carries a stereotype are read. `@Bean` outside a `@Configuration`
 * (or `@SpringBootApplication`, or a `@Component`) is not wired by Spring either.
 */
export const addBeanFactories = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  roles: readonly BeanRole[],
  context: IndexingContext,
): void => {
  const stereotyped = new Set(roles.map((role) => role.classNodeId));
  const methods = methodNodesById(graph);
  for (const fact of springAnnotations(graph)) {
    const methodName = methods.get(fact.targetNodeId);
    if (fact.decoratorName !== BEAN || methodName === undefined) {
      continue;
    }
    if (!stereotyped.has(owningClassNodeId(fact.targetNodeId))) {
      builder.warn(
        fact.filePath,
        `@Bean method '${methodName}' is not inside an annotated configuration class — skipped`,
      );
      continue;
    }
    emitBeanFactory(builder, fact, beanNameOf(fact, methodName), context);
  }
};

const emitBeanFactory = (
  builder: FragmentBuilder,
  fact: DecoratorFact,
  beanName: string,
  context: IndexingContext,
): void => {
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  const nodeId = beanFactoryNodeId(fact.targetNodeId);
  builder.addNode(
    {
      id: nodeId,
      category: 'application',
      type: 'service',
      name: beanName,
      path: fact.filePath,
      knowledge,
    },
    fact.filePath,
  );
  builder.addEdge(
    {
      id: `spring:contains:${fact.targetNodeId}->${nodeId}`,
      type: 'CONTAINS',
      sourceId: fact.targetNodeId,
      targetId: nodeId,
      knowledge,
    },
    fact.filePath,
  );
};

interface RoleInput {
  readonly fact: CodeGraph['decorators'][number];
  readonly className: string;
  readonly nodeType: string;
  readonly context: IndexingContext;
}

const emitRole = (builder: FragmentBuilder, input: RoleInput): void => {
  const { fact, className, nodeType, context } = input;
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  const nodeId = beanNodeId(nodeType, fact.targetNodeId);
  builder.addNode(
    {
      id: nodeId,
      category: 'application',
      type: nodeType,
      name: className,
      path: fact.filePath,
      knowledge,
    },
    fact.filePath,
  );
  builder.addEdge(
    {
      id: `spring:contains:${fact.targetNodeId}->${nodeId}`,
      type: 'CONTAINS',
      sourceId: fact.targetNodeId,
      targetId: nodeId,
      knowledge,
    },
    fact.filePath,
  );
};
