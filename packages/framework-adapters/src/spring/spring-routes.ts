import { deterministicEnvelope } from '@impactgraph/language-adapters';

import { routeIdentity } from '../route-contract.js';

import {
  declaredPath,
  declaredVerb,
  MAPPING_METHODS,
  owningClassNodeId,
  REQUEST_MAPPING,
  springAnnotations,
} from './spring-annotations.js';
import { beanNodeId } from './spring-beans.js';

import type { BeanRole } from './spring-beans.js';
import type { CodeGraph } from '../types.js';
import type {
  DecoratorFact,
  FragmentBuilder,
  IndexingContext,
} from '@impactgraph/language-adapters';

// `@GetMapping`/`@PostMapping`/`@RequestMapping` → api-endpoint nodes with EXPOSES edges
// (PRD §15.2). Class-level and method-level paths compose exactly as Spring composes them.
// Node ids match the NestJS and FastAPI route ids (`route:<VERB> <path>`) on purpose: a route is
// a route whatever framework declared it, which is what makes cross-stack matching possible
// (PRD §C13).

const joinPath = (...segments: readonly string[]): string => {
  const parts = segments.flatMap((segment) => segment.split('/')).filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
};

const isMapping = (name: string): boolean => name in MAPPING_METHODS || name === REQUEST_MAPPING;

/**
 * `@RequestMapping` on a class contributes the prefix its methods hang off. On a method it is a
 * mapping in its own right, so a class-level fact is one whose target is a controller class.
 */
const classPrefixes = (
  graph: CodeGraph,
  controllers: ReadonlySet<string>,
): ReadonlyMap<string, string> => {
  const prefixes = new Map<string, string>();
  for (const fact of springAnnotations(graph)) {
    if (fact.decoratorName === REQUEST_MAPPING && controllers.has(fact.targetNodeId)) {
      prefixes.set(fact.targetNodeId, declaredPath(fact));
    }
  }
  return prefixes;
};

interface RouteInput {
  readonly builder: FragmentBuilder;
  readonly fact: DecoratorFact;
  readonly controllerNodeId: string;
  readonly prefix: string;
  readonly context: IndexingContext;
}

const emitRoute = (input: RouteInput): void => {
  const { builder, fact, controllerNodeId, prefix, context } = input;
  // `@RequestMapping` without an explicit `method` maps every verb — reported as ANY rather than
  // silently defaulting to GET, which would be a guess about the application's surface.
  const verb = MAPPING_METHODS[fact.decoratorName] ?? declaredVerb(fact) ?? 'ANY';
  const fullPath = joinPath(prefix, declaredPath(fact));
  const identity = routeIdentity(verb, fullPath);
  const routeNodeId = identity.nodeId;
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'framework-convention');
  builder.addNode(
    {
      id: routeNodeId,
      category: 'application',
      type: 'api-endpoint',
      name: identity.name,
      route: identity.route,
      path: fact.filePath,
      knowledge,
    },
    fact.filePath,
  );
  for (const sourceId of [controllerNodeId, fact.targetNodeId]) {
    builder.addEdge(
      {
        id: `spring:exposes:${sourceId}->${routeNodeId}`,
        type: 'EXPOSES',
        sourceId,
        targetId: routeNodeId,
        knowledge,
      },
      fact.filePath,
    );
  }
};

/** Every mapping annotation on a method of an annotated controller becomes one route. */
export const addRoutes = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  roles: readonly BeanRole[],
  context: IndexingContext,
): void => {
  const controllers = new Set(
    roles.filter((role) => role.nodeType === 'controller').map((role) => role.classNodeId),
  );
  const prefixes = classPrefixes(graph, controllers);
  for (const fact of springAnnotations(graph)) {
    const classNodeId = owningClassNodeId(fact.targetNodeId);
    const isClassLevel = classNodeId === fact.targetNodeId;
    if (!isMapping(fact.decoratorName) || isClassLevel || !controllers.has(classNodeId)) {
      continue; // not a mapping, the class-level prefix itself, or outside a controller
    }
    emitRoute({
      builder,
      fact,
      controllerNodeId: beanNodeId('controller', classNodeId),
      prefix: prefixes.get(classNodeId) ?? '',
      context,
    });
  }
};
