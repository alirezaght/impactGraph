import { FragmentBuilder } from '@impactgraph/language-adapters';

import { addCollectionReads, addCollections } from './astro-collections.js';
import { addApiRoutes, addPages } from './astro-routing.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

// Story 16.4 — Astro enrichment (PRD §15.2, §31): file-based pages, API routes, and content
// collections. Reads the assembled CodeGraph only; the `.astro` splitting and parsing happened
// once, in the language adapter (ADR-0014).

const isAstroComponent = (path: string | undefined): boolean =>
  path !== undefined && path.endsWith('.astro');

class AstroFrameworkAdapter implements FrameworkAdapter {
  public readonly id = 'astro';
  public readonly languageIds: readonly string[] = ['astro', 'typescript'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const components = graph.nodes.filter(
      (node) => node.type === 'ui-component' && isAstroComponent(node.path),
    );
    return Promise.resolve({
      detected: components.length > 0,
      evidenceIds: components.flatMap((node) => [...node.knowledge.evidenceIds]),
      reason:
        components.length > 0
          ? `Astro components present (${String(components.length)} files)`
          : 'no .astro components found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    addPages(builder, graph, context.indexing);
    addApiRoutes(builder, graph, context.indexing);
    const declared = addCollections(builder, graph, context.indexing);
    addCollectionReads({ builder, graph, declared, context: context.indexing });
    return Promise.resolve(builder.build());
  }
}

export const createAstroFrameworkAdapter = (): FrameworkAdapter => new AstroFrameworkAdapter();
