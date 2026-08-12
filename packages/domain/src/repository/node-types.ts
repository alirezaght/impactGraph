// PRD §12.1 — the node vocabulary, verbatim, grouped by category. `package` is legitimately
// in two categories, so a node carries both `category` and `type`, validated as a pair.
export const NODE_TYPES_BY_CATEGORY = Object.freeze({
  intent: [
    'specification',
    'requirement',
    'constraint',
    'actor',
    'business-rule',
    'open-question',
    'architectural-decision',
  ],
  domain: [
    'domain',
    'bounded-context',
    'aggregate',
    'entity',
    'value-object',
    'policy',
    'invariant',
    'command',
    'query',
    'domain-event',
  ],
  application: [
    'application',
    'service',
    'module',
    'package',
    'class',
    'interface',
    'function',
    'method',
    'api-endpoint',
    'controller',
    'handler',
    'job',
    'cli-command',
    'ui-component',
    'page',
    'form',
    'test',
    // ADR-0017 — symbol members. Resolution stopped at the file and the top-level symbol, so
    // `ItemType.ANGEBOT` could be assumed by a specification and never contradicted, because
    // `ItemType` existed and nothing modelled what was inside it.
    /** An enum declaration — the container whose members a specification may assume. */
    'enum',
    /** One member of an enum. */
    'enum-member',
    /** One literal of a union type or a const-object value set. */
    'union-literal',
  ],
  data: [
    'database',
    'schema',
    'table',
    'collection',
    'column',
    'index',
    'migration',
    'cache',
    'search-index',
    /**
     * A named payload/DTO field, tracked for field-level flow (item 7). In `data` because a field
     * is a data-shape fact: it is the same kind of thing as a column, observed in code instead of
     * in a schema, and the flow queries treat the two interchangeably.
     */
    'field',
  ],
  integration: [
    'topic',
    'queue',
    'subscription',
    'publisher',
    'consumer',
    'webhook',
    'external-api',
    'third-party-service',
    /**
     * A durable record written inside the producer's transaction and relayed later — the first hop
     * of an outbox chain (item 5). Distinct from `publisher`: the write is committed with the
     * business change, and the publish happens elsewhere, which is exactly why the chain was
     * invisible when only direct publish calls were modelled.
     */
    'outbox-record',
    /** A subscriber-side HTTP endpoint a push subscription delivers to (item 5). */
    'push-endpoint',
    /** A read model or materialized view maintained from consumed events (item 5). */
    'projection',
    /**
     * A boundary the analysis KNOWS it cannot resolve: an outbound call, topic, or event whose
     * consumer lives outside the indexed scope. Modelled explicitly so "no consumers" is never
     * reported when the truth is "not analyzed" (items 5, 6, 11).
     */
    'unresolved-external-boundary',
  ],
  infrastructure: [
    'terraform-module',
    'terraform-resource',
    'cloud-run-service',
    'cloud-run-job',
    'gcp-project',
    'pubsub-topic',
    'pubsub-subscription',
    'service-account',
    'iam-role',
    'secret',
    'environment-variable',
    'docker-image',
    'deployment-pipeline',
    // ADR-0017 — the runtime layer. These exist because a deployment topology is not a dependency
    // graph: the process that actually serves a request is frequently NOT the service the code and
    // the plan both name, and nothing in the source graph can express that difference.
    /** A process that actually serves traffic — an aggregator, a gateway worker, a sidecar. */
    'runtime-process',
    /** One container within a runtime resource; the unit that does or does not receive env vars. */
    'container',
    /** A configured URL, as the frontend or a caller knows it, before resolution. */
    'service-url',
    /** A Terraform `locals` entry — the usual hop where a nominal name becomes a real target. */
    'terraform-local',
    'terraform-output',
    'terraform-variable',
  ],
  repository: ['repository', 'workspace', 'package', 'directory', 'file', 'symbol'],
  /**
   * Non-code artifacts that are part of an implementation (item 8). They were previously indexed as
   * plain files, which made a locale entry indistinguishable from a README and meant a change that
   * was largely translation work looked like it touched nothing relevant.
   */
  asset: [
    'configuration-file',
    /** One locale/translation file. */
    'locale-bundle',
    /** One dotted key inside a locale bundle, e.g. `nda.signature_request.subject`. */
    'translation-key',
    'json-schema',
    'openapi-document',
    /** One `path + method` operation declared by an OpenAPI document. */
    'openapi-operation',
    'template',
    /** A declared event/message contract document (AsyncAPI, JSON event schema, proto). */
    'event-definition',
    'generated-contract',
    /** One key in a configuration surface — settings class, env schema, config map (ADR-0017). */
    'config-key',
    /** A named feature flag. Validated for existence like any other referenced member. */
    'feature-flag',
  ],
  /**
   * ADR-0017 — repository rules as first-class entities.
   *
   * A CI guard is not application code that happens to live under `ci/`. It governs other code, it
   * has exemptions, and it can make a design impossible. Indexing it as a plain file loses all
   * three, which is why it gets its own category rather than a node type inside `repository`.
   */
  governance: [
    /** An indexed repository rule. See domain/constraint. */
    'repository-constraint',
    /** The guard that declares one or more constraints: a CI script, a lint config, a guard test. */
    'ci-check',
    /** One named escape from a constraint, carrying its own source location. */
    'constraint-exemption',
  ],
} as const);

export type NodeCategory = keyof typeof NODE_TYPES_BY_CATEGORY;

export type NodeType = (typeof NODE_TYPES_BY_CATEGORY)[NodeCategory][number];

export const NODE_CATEGORIES = Object.freeze(
  Object.keys(NODE_TYPES_BY_CATEGORY),
) as readonly NodeCategory[];

export const isNodeCategory = (value: unknown): value is NodeCategory =>
  typeof value === 'string' && value in NODE_TYPES_BY_CATEGORY;

export const isNodeTypeInCategory = (category: NodeCategory, type: string): boolean =>
  (NODE_TYPES_BY_CATEGORY[category] as readonly string[]).includes(type);
