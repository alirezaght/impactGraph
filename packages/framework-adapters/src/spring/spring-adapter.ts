import { FragmentBuilder } from '@impactgraph/language-adapters';

import { springAnnotations } from './spring-annotations.js';
import { addBeanFactories, addBeanRoles } from './spring-beans.js';
import { addFieldInjections } from './spring-injection.js';
import { addScheduledJobs } from './spring-jobs.js';
import { addRoutes } from './spring-routes.js';
import { addValueConfiguredTopics } from './spring-value-topics.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

// Story 16.5 — Spring enrichment (PRD §15.2, §31): stereotypes, controllers, and request
// mappings. Reads the assembled CodeGraph only; never re-parses a file, never runs one.
//
// `@Value("${deals.topic}")` used as a Pub/Sub resource name IS resolved here (epic-16), against
// the owning module's own `application.yml`/`application.properties`. It belongs to Spring rather
// than to the Java adapter for the ordinary reason: the annotation and the configuration entry are
// two files, a language adapter parses one file at a time, and joining files is what a framework
// adapter is for (PRD §31). See `spring-value-topics.ts` for the rule and every refusal.
//
// Constructor injection deliberately produces NO edge here. A constructor parameter type is a
// static dependency whatever framework wires it, so the Java adapter reports it as an `injects`
// reference and the assembly stage turns it into a USES edge with `static-analysis` provenance —
// the same path the TypeScript adapter and NestJS take. Re-emitting it under a framework label
// would duplicate a true edge, not add information.

class SpringAdapter implements FrameworkAdapter {
  public readonly id = 'spring';
  public readonly languageIds: readonly string[] = ['java'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const markers = springAnnotations(graph);
    return Promise.resolve({
      detected: markers.length > 0,
      evidenceIds: markers.map((fact) => fact.evidenceId),
      reason:
        markers.length > 0
          ? `Spring annotations present in Java sources (${String(markers.length)} markers)`
          : 'no Spring annotations found in Java sources',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    const roles = addBeanRoles(builder, graph, context.indexing);
    addRoutes(builder, graph, roles, context.indexing);
    addBeanFactories(builder, graph, roles, context.indexing);
    addScheduledJobs(builder, graph, context.indexing);
    addFieldInjections(builder, graph, context.indexing);
    addValueConfiguredTopics(builder, graph, context.indexing);
    return Promise.resolve(builder.build());
  }
}

export const createSpringAdapter = (): FrameworkAdapter => new SpringAdapter();
