import { deterministicEnvelope, FIELD_TYPE_RECEIVER } from '@impactgraph/language-adapters';

import {
  INJECTION_ANNOTATIONS,
  owningClassNodeId,
  springAnnotations,
} from './spring-annotations.js';

import type { CodeGraph } from '../types.js';
import type {
  DecoratorFact,
  FragmentBuilder,
  IndexingContext,
} from '@impactgraph/language-adapters';

// Field injection: `@Autowired private DealService dealService;` → USES (PRD §15.2).
//
// Constructor injection deliberately produces no edge here — the Java adapter already reports a
// constructor parameter as a static dependency and assembly turns it into USES. A FIELD is
// different: nothing about `private DealService dealService;` says the class collaborates with it
// rather than merely holding it, and emitting an edge for every field would bury real dependencies
// under every `String`, `Clock` and `Logger` in the repository. `@Autowired` is what states the
// wiring, so the annotation is the trigger and `framework-convention` is the provenance — the
// declared type it points at is a parsed fact the Java adapter recorded on the field-type channel.
//
// An edge that assembly already produced (a class with both a constructor parameter and an
// annotated field of the same type) is left alone rather than duplicated under a second id.

/** Field name → declared type per class, from the Java adapter's `java:field-type` facts. */
const fieldTypesByClass = (graph: CodeGraph): ReadonlyMap<string, string> => {
  const types = new Map<string, string>();
  for (const fact of graph.callFacts) {
    const owner = fact.enclosingSymbolNodeId;
    if (fact.receiverName === FIELD_TYPE_RECEIVER && owner !== undefined) {
      types.set(`${owner}.${fact.assignedTo ?? ''}`, fact.calleeName);
    }
  }
  return types;
};

interface InjectionInput {
  readonly builder: FragmentBuilder;
  readonly graph: CodeGraph;
  readonly fieldTypes: ReadonlyMap<string, string>;
  readonly context: IndexingContext;
}

const linkInjectedField = (input: InjectionInput, fact: DecoratorFact): void => {
  const { builder, graph, fieldTypes, context } = input;
  const classNodeId = owningClassNodeId(fact.targetNodeId);
  const typeName = fieldTypes.get(fact.targetNodeId);
  const targetId =
    typeName === undefined ? undefined : graph.resolveSymbol(fact.filePath, typeName);
  if (targetId === undefined) {
    builder.warn(
      fact.filePath,
      `@${fact.decoratorName} field '${fact.targetNodeId}' declares a type this repository does ` +
        'not contain — no dependency edge',
    );
    return;
  }
  const existing = `injects:${classNodeId}->${targetId}`;
  if (graph.edges.some((edge) => edge.id === existing)) {
    return; // constructor injection already stated this dependency
  }
  builder.addEdge(
    {
      id: `spring:autowired:${classNodeId}->${targetId}`,
      type: 'INJECTS',
      sourceId: classNodeId,
      targetId,
      knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
    },
    fact.filePath,
  );
};

/** Every `@Autowired`/`@Inject`/`@Resource` field becomes an INJECTS edge to the type it declares. */
export const addFieldInjections = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const fieldTypes = fieldTypesByClass(graph);
  for (const fact of springAnnotations(graph)) {
    if (INJECTION_ANNOTATIONS.has(fact.decoratorName)) {
      linkInjectedField({ builder, graph, fieldTypes, context }, fact);
    }
  }
};
