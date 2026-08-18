import type { KnowledgeGraph } from '@impactgraph/domain';

/**
 * The deterministic language recognizers a requirement is read with.
 *
 * They live here, in one module, because three consumers need the same reading and must never
 * disagree about it: the preflight requirement classifier ("is this unmatched requirement new
 * construction or a coverage gap?"), the coverage verdict, and the unresolved-surface classifier
 * (ADR-0025). Two copies of the creation vocabulary is how a specification ends up classified as
 * NEW_SURFACE by one surface and INSUFFICIENT_COVERAGE by another in the same response.
 */

/**
 * Language that describes bringing something into existence rather than changing something.
 *
 * The first version of this list held only `add`/`create`/`new`/`introduce`, and a self-run showed
 * why that is too narrow: "Index repository rules as first-class entities" and "Model runtime
 * topology" both create surface, and both fell through to `NO_EVIDENCE` — the honest fallback, but
 * the wrong answer. A specification writes creation as whatever verb suits the noun.
 *
 * Widening this is safe only because it is one signal among several and only ever consulted about
 * something that matched NOTHING. A requirement that modifies existing surface has impacts, so it
 * is never classified at all.
 */
const CREATION =
  /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|support for|index|model|models|modelled|emit|emits|expose|exposes|record|records|classify|classifies|derive|derives|represent|represents|extract|extracts|validate|validates)\b/i;

/** Language that names a system this repository does not contain. */
const EXTERNAL =
  /\b(third[- ]party|external (?:service|system|api)|vendor|upstream provider|sendgrid|stripe|twilio)\b/i;

export const usesCreationLanguage = (statement: string): boolean => CREATION.test(statement);

export const referencesExternalBoundary = (statement: string): boolean => EXTERNAL.test(statement);

/** Node types that indicate a KIND of surface is indexed at all — the NEW_SURFACE evidence. */
const SURFACE_KINDS: readonly { readonly pattern: RegExp; readonly types: readonly string[] }[] = [
  {
    pattern: /\b(localization|localisation|i18n|translation|locale)\b/i,
    types: ['locale-bundle', 'translation-key'],
  },
  { pattern: /\b(route|endpoint|path)\b/i, types: ['api-endpoint', 'controller', 'handler'] },
  { pattern: /\b(schema|contract)\b/i, types: ['json-schema', 'openapi-document', 'schema'] },
  { pattern: /\b(migration)\b/i, types: ['migration'] },
  { pattern: /\b(feature flag)\b/i, types: ['feature-flag'] },
  { pattern: /\b(event|topic|queue)\b/i, types: ['topic', 'pubsub-topic', 'domain-event'] },
];

export const indexedTypes = (graph: KnowledgeGraph): ReadonlySet<string> => {
  const types = new Set<string>();
  for (const node of graph.nodes.values()) {
    types.add(node.type);
  }
  return types;
};

/**
 * True when the repository already indexes surfaces of the kind the statement talks about. That is
 * what separates "this does not exist yet" from "we cannot see this part of the system": if the
 * index holds routes and the route named is not among them, the index reached here and the route
 * is absent.
 */
export const siblingSurfaceIndexed = (statement: string, types: ReadonlySet<string>): boolean =>
  SURFACE_KINDS.some(
    (kind) => kind.pattern.test(statement) && kind.types.some((type) => types.has(type)),
  );
