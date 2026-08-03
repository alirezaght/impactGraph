import { FragmentBuilder } from '@impactgraph/language-adapters';

import { addBackgroundTasks, addPydanticModels } from './fastapi-models.js';
import { addHolderNodes, addMountEdges, addRoutes } from './fastapi-routes.js';
import { discoverFastApiWorld } from './fastapi-world.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

// Story 16.2 — FastAPI enrichment (PRD §15.2, §31): routers, endpoints, Pydantic models, and
// background tasks. Reads the assembled CodeGraph only; never re-parses a file, never runs one.

const CONSTRUCTORS = new Set(['FastAPI', 'APIRouter']);

const FASTAPI_MODULES = ['fastapi', 'pydantic'];

const importMarkers = (graph: CodeGraph): readonly string[] => {
  const evidenceIds: string[] = [];
  for (const node of graph.nodes) {
    if (node.path === undefined || !node.id.startsWith('file:')) {
      continue;
    }
    for (const reference of graph.importsOf(node.path)) {
      const root = reference.specifier.split('.')[0] ?? '';
      if (FASTAPI_MODULES.includes(root)) {
        evidenceIds.push(reference.evidenceId);
      }
    }
  }
  return evidenceIds;
};

class FastApiAdapter implements FrameworkAdapter {
  public readonly id = 'fastapi';
  public readonly languageIds: readonly string[] = ['python'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const constructed = graph.callFacts.filter(
      (fact) => CONSTRUCTORS.has(fact.calleeName) && fact.receiverName === undefined,
    );
    const evidenceIds = [...constructed.map((fact) => fact.evidenceId), ...importMarkers(graph)];
    return Promise.resolve({
      detected: constructed.length > 0,
      evidenceIds,
      reason:
        constructed.length > 0
          ? `FastAPI/APIRouter construction present (${String(constructed.length)} sites)`
          : 'no FastAPI application or router construction found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    const world = discoverFastApiWorld(graph);
    const input = { builder, graph, world, context: context.indexing };
    addHolderNodes(input);
    addMountEdges(input);
    addRoutes(input);
    addPydanticModels(builder, graph, context.indexing);
    addBackgroundTasks(builder, graph, context.indexing);
    return Promise.resolve(builder.build());
  }
}

export const createFastApiAdapter = (): FrameworkAdapter => new FastApiAdapter();
