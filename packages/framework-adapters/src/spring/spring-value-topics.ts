import {
  deterministicEnvelope,
  PUBSUB_CONFIG_NAME_RECEIVER,
  springModuleOfSource,
  unresolvedNameKind,
} from '@impactgraph/language-adapters';

import { resolvePlaceholder } from './spring-placeholder.js';
import { springPropertySources } from './spring-properties.js';

import type { SpringPropertySources } from './spring-properties.js';
import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type {
  CallFact,
  DecoratorFact,
  FragmentBuilder,
  IndexingContext,
  PubSubResourceKind,
} from '@impactgraph/language-adapters';

// `pubSubTemplate.publish(configuredTopic, payload)` + `@Value("${deals.topic}")` on the field +
// `deals.topic: deal-events` in the module's `application.yml` = a topic this repository states,
// in two files that each state their half (epic-16).
//
// This is the join, and it is a join over facts other components already proved: the Java adapter
// recorded the identifier and the annotation, the `spring-config` adapter recorded the
// configuration entry, and nothing is re-parsed here. Provenance is `framework-convention` — that
// a Spring placeholder is filled from `application.yml` is knowledge about Spring, not something
// either file states — and the evidence cites BOTH sites, so a reviewer opens the annotation and
// the configuration line and checks the claim rather than trusting it.
//
// Refusals live in `spring-placeholder.ts`; every one of them produces a warning and no node.

/** `symbol:<file>#<Class>.<method>` + `topicField` → `symbol:<file>#<Class>.topicField`. */
const siblingFieldId = (enclosingSymbolNodeId: string, identifier: string): string | undefined => {
  const hash = enclosingSymbolNodeId.indexOf('#');
  const lastDot = enclosingSymbolNodeId.lastIndexOf('.');
  if (hash < 0 || lastDot < hash) {
    return undefined;
  }
  return `${enclosingSymbolNodeId.slice(0, lastDot)}.${identifier}`;
};

const VALUE_ANNOTATION = 'Value';

/** Target node id → the `@Value` annotation on it. A `Map`: the ids come from repository text. */
const valueAnnotations = (graph: CodeGraph): ReadonlyMap<string, DecoratorFact> => {
  const byTarget = new Map<string, DecoratorFact>();
  for (const fact of graph.decorators) {
    if (fact.decoratorName === VALUE_ANNOTATION && !byTarget.has(fact.targetNodeId)) {
      byTarget.set(fact.targetNodeId, fact);
    }
  }
  return byTarget;
};

const EDGE_TYPE: ReadonlyMap<PubSubResourceKind, string> = new Map([
  ['topic', 'PUBLISHES'],
  ['subscription', 'SUBSCRIBES_TO'],
]);

interface Emission {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly kind: PubSubResourceKind;
  readonly name: string;
  readonly sourceId: string;
  readonly filePath: string;
  /** Annotation first, configuration entry second — the two sites the claim rests on. */
  readonly evidenceIds: readonly string[];
}

const emit = (emission: Emission, existing: ReadonlySet<string>): void => {
  const { builder, context, kind, name, sourceId, filePath, evidenceIds } = emission;
  const nodeId = `${kind}:${name}`;
  const knowledge = deterministicEnvelope(context, evidenceIds, 'framework-convention');
  if (!existing.has(nodeId)) {
    builder.addNode(
      { id: nodeId, category: 'integration', type: kind, name, path: filePath, knowledge },
      filePath,
    );
  }
  // §12.2.1: USES_UNKNOWN rather than a generic USES, so an unclassifiable binding would be named
  // honestly. Currently UNREACHABLE — the handle-kind union is exactly 'topic' | 'subscription' and
  // the map above covers both — so this is defensive, not a live bucket. Kept because a kind added to
  // that union must fail loudly as an unknown rather than silently borrow a relationship it is not.
  const type = EDGE_TYPE.get(kind) ?? 'USES_UNKNOWN';
  builder.addEdge(
    {
      id: `pubsub:${type.toLowerCase()}:${sourceId}->${nodeId}`,
      type,
      sourceId,
      targetId: nodeId,
      knowledge,
    },
    filePath,
  );
};

interface Join {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly annotations: ReadonlyMap<string, DecoratorFact>;
  readonly sources: SpringPropertySources;
  readonly existing: ReadonlySet<string>;
}

/** Everything the join needs about one unresolved-name fact. */
interface Subject {
  readonly kind: PubSubResourceKind;
  readonly sourceId: string;
  readonly annotation: DecoratorFact;
  readonly placeholder: string;
  readonly moduleRoot: string;
}

const annotationFor = (join: Join, fact: CallFact): DecoratorFact | undefined => {
  const sourceId = fact.enclosingSymbolNodeId;
  const fieldId = sourceId === undefined ? undefined : siblingFieldId(sourceId, fact.calleeName);
  return fieldId === undefined ? undefined : join.annotations.get(fieldId);
};

/**
 * A field with no `@Value`, a `@Value` stating no placeholder, or a source file outside the
 * Maven/Gradle layout all yield undefined — the repository states no value, and the Java adapter
 * has already warned that the call names a resource its own file cannot value (PRD §35).
 */
const subjectOf = (join: Join, fact: CallFact): Subject | undefined => {
  const kind = unresolvedNameKind(fact.stringArguments);
  const sourceId = fact.enclosingSymbolNodeId;
  const annotation = annotationFor(join, fact);
  const placeholder = annotation?.stringArguments[0];
  const moduleRoot = springModuleOfSource(fact.filePath);
  if (kind === undefined || sourceId === undefined || annotation === undefined) {
    return undefined;
  }
  return placeholder === undefined || moduleRoot === undefined
    ? undefined
    : { kind, sourceId, annotation, placeholder, moduleRoot };
};

const resolveOne = (join: Join, fact: CallFact): void => {
  const subject = subjectOf(join, fact);
  if (subject === undefined) {
    return;
  }
  const resolved = resolvePlaceholder(subject.placeholder, subject.moduleRoot, join.sources);
  if (resolved.name === undefined) {
    join.builder.warn(
      fact.filePath,
      `@Value("${subject.placeholder}") supplies no ${subject.kind} name — ` +
        (resolved.refusal ?? 'unresolved'),
    );
    return;
  }
  emit(
    {
      builder: join.builder,
      context: join.context,
      kind: subject.kind,
      name: resolved.name,
      sourceId: subject.sourceId,
      filePath: fact.filePath,
      evidenceIds: [
        subject.annotation.evidenceId,
        ...(resolved.configEvidenceId === undefined ? [] : [resolved.configEvidenceId]),
      ],
    },
    join.existing,
  );
};

/**
 * Resolve every `@Value`-configured Pub/Sub name in the graph. A fact whose field carries no
 * `@Value`, or whose key the module's configuration does not state, produces nothing.
 */
export const addValueConfiguredTopics = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const join: Join = {
    builder,
    context,
    annotations: valueAnnotations(graph),
    sources: springPropertySources(graph),
    existing: new Set(graph.nodes.map((node: GraphNode) => node.id)),
  };
  for (const fact of graph.callFacts) {
    if (fact.receiverName === PUBSUB_CONFIG_NAME_RECEIVER) {
      resolveOne(join, fact);
    }
  }
};
