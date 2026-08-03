import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { DecoratorFact, GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Story 3.2 — NestJS enrichment from decorator facts (PRD §15.2). All emitted facts carry
// `framework-convention` provenance and the decorator evidence that triggered them. Neutral
// §12 vocabulary only — framework identity lives in provenance + evidence, never in new types.

const HTTP_DECORATORS: Readonly<Record<string, string>> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Delete: 'DELETE',
  Patch: 'PATCH',
  Options: 'OPTIONS',
  Head: 'HEAD',
};

const MARKER_DECORATORS = new Set(['Module', 'Controller', 'Injectable']);

const joinPath = (...segments: readonly (string | undefined)[]): string => {
  const parts = segments
    .filter((segment): segment is string => segment !== undefined && segment.length > 0)
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
};

interface NestFacts {
  readonly modules: readonly DecoratorFact[];
  readonly controllers: readonly DecoratorFact[];
  readonly routes: readonly DecoratorFact[];
  readonly jobs: readonly DecoratorFact[];
  readonly eventHandlers: readonly DecoratorFact[];
}

const collectFacts = (graph: CodeGraph): NestFacts => ({
  modules: graph.decorators.filter((fact) => fact.decoratorName === 'Module'),
  controllers: graph.decorators.filter((fact) => fact.decoratorName === 'Controller'),
  routes: graph.decorators.filter((fact) => fact.decoratorName in HTTP_DECORATORS),
  jobs: graph.decorators.filter((fact) => fact.decoratorName === 'Cron'),
  eventHandlers: graph.decorators.filter((fact) => fact.decoratorName === 'OnEvent'),
});

const addModuleFacts = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  fact: DecoratorFact,
  context: IndexingContext,
): void => {
  const relationships: readonly [string, string][] = [
    ['controllers', 'OWNS'],
    ['providers', 'OWNS'],
    ['imports', 'DEPENDS_ON'],
  ];
  for (const [listName, edgeType] of relationships) {
    for (const name of fact.identifierLists[listName] ?? []) {
      const targetId = graph.resolveSymbol(fact.filePath, name);
      if (targetId === undefined) {
        builder.warn(fact.filePath, `NestJS module references unresolvable '${name}'`);
        continue;
      }
      builder.addEdge(
        {
          id: `nestjs:${edgeType.toLowerCase()}:${fact.targetNodeId}->${targetId}`,
          type: edgeType,
          sourceId: fact.targetNodeId,
          targetId,
          knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
        },
        fact.filePath,
      );
    }
  }
};

const addRouteFacts = (
  builder: FragmentBuilder,
  facts: NestFacts,
  context: IndexingContext,
): void => {
  const prefixByController = new Map(
    facts.controllers.map((fact) => [fact.targetNodeId, fact.stringArguments[0]]),
  );
  for (const route of facts.routes) {
    // Method node ids look like `symbol:<file>#<Class>.<method>` — derive the class node id.
    const classNodeId = route.targetNodeId.replace(/\.[^.#]+$/, '');
    if (!prefixByController.has(classNodeId)) {
      continue; // HTTP decorator outside a @Controller class — not a route
    }
    const method = HTTP_DECORATORS[route.decoratorName] ?? 'GET';
    const fullPath = joinPath(prefixByController.get(classNodeId), route.stringArguments[0]);
    const routeNodeId = `route:${method} ${fullPath}`;
    builder.addNode(
      {
        id: routeNodeId,
        category: 'application',
        type: 'api-endpoint',
        name: `${method} ${fullPath}`,
        path: route.filePath,
        knowledge: deterministicEnvelope(context, [route.evidenceId], 'framework-convention'),
      },
      route.filePath,
    );
    builder.addEdge(
      {
        id: `nestjs:exposes:${route.targetNodeId}->${routeNodeId}`,
        type: 'EXPOSES',
        sourceId: route.targetNodeId,
        targetId: routeNodeId,
        knowledge: deterministicEnvelope(context, [route.evidenceId], 'framework-convention'),
      },
      route.filePath,
    );
  }
};

const addJobAndEventFacts = (
  builder: FragmentBuilder,
  facts: NestFacts,
  context: IndexingContext,
): void => {
  for (const job of facts.jobs) {
    const jobNodeId = `job:${job.targetNodeId}`;
    builder.addNode(
      {
        id: jobNodeId,
        category: 'application',
        type: 'job',
        name: `scheduled ${job.stringArguments[0] ?? ''}`.trim(),
        path: job.filePath,
        knowledge: deterministicEnvelope(context, [job.evidenceId], 'framework-convention'),
      },
      job.filePath,
    );
    builder.addEdge(
      {
        id: `nestjs:triggers:${jobNodeId}->${job.targetNodeId}`,
        type: 'TRIGGERS',
        sourceId: jobNodeId,
        targetId: job.targetNodeId,
        knowledge: deterministicEnvelope(context, [job.evidenceId], 'framework-convention'),
      },
      job.filePath,
    );
  }
  for (const handler of facts.eventHandlers) {
    const eventName = handler.stringArguments[0];
    if (eventName === undefined) {
      continue;
    }
    const topicNodeId = `topic:${eventName}`;
    builder.addNode(
      {
        id: topicNodeId,
        category: 'integration',
        type: 'topic',
        name: eventName,
        path: handler.filePath,
        knowledge: deterministicEnvelope(context, [handler.evidenceId], 'framework-convention'),
      },
      handler.filePath,
    );
    builder.addEdge(
      {
        id: `nestjs:subscribes:${handler.targetNodeId}->${topicNodeId}`,
        type: 'SUBSCRIBES_TO',
        sourceId: handler.targetNodeId,
        targetId: topicNodeId,
        knowledge: deterministicEnvelope(context, [handler.evidenceId], 'framework-convention'),
      },
      handler.filePath,
    );
  }
};

class NestJsAdapter implements FrameworkAdapter {
  public readonly id = 'nestjs';
  public readonly languageIds: readonly string[] = ['typescript'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const markers = graph.decorators.filter((fact) => MARKER_DECORATORS.has(fact.decoratorName));
    return Promise.resolve({
      detected: markers.length > 0,
      evidenceIds: markers.map((fact) => fact.evidenceId),
      reason:
        markers.length > 0
          ? `NestJS decorators present (${String(markers.length)} markers)`
          : 'no NestJS decorators found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    const facts = collectFacts(graph);
    for (const moduleFact of facts.modules) {
      addModuleFacts(builder, graph, moduleFact, context.indexing);
    }
    addRouteFacts(builder, facts, context.indexing);
    addJobAndEventFacts(builder, facts, context.indexing);
    return Promise.resolve(builder.build());
  }
}

export const createNestJsAdapter = (): FrameworkAdapter => new NestJsAdapter();
