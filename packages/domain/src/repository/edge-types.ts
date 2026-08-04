// PRD §12.2 — the edge-type roster, verbatim and in PRD order, plus the §12.2.1 relationship
// split. Direction is normative per type: see §12.2.1: an INJECTS edge always points from the
// consumer to the injected dependency, whatever produced it, so propagation rules stay local.
export const EDGE_TYPES = [
  'CONTAINS',
  'IMPORTS',
  'CALLS',
  'IMPLEMENTS',
  'EXTENDS',
  'READS_FROM',
  'WRITES_TO',
  'PUBLISHES',
  'SUBSCRIBES_TO',
  'TRIGGERS',
  'DEPLOYED_AS',
  'CONFIGURES',
  'OWNS',
  'BELONGS_TO_CONTEXT',
  'VALIDATES',
  'ENFORCES',
  'TESTS',
  'MIGRATES',
  'EXPOSES',
  'USES',
  // §12.2.1 — the relationship split. USES carried seven unrelated facts and doubled as the
  // adapter fallback, so any rule attached to it was wrong for some producers.
  'INJECTS',
  'NAVIGATES_TO',
  'SUBMITS_TO',
  'CALLS_ENDPOINT',
  'USES_MIDDLEWARE',
  'REFERENCES_RESOURCE',
  // Reserved (§12.2.1): no producer yet — every pub/sub adapter resolves direction already.
  'BINDS',
  /**
   * An unclassified relationship, named honestly rather than hidden inside USES. Traversable, may
   * contribute at most a `possible` tier, never corroborates, and carries no positive confidence.
   */
  'USES_UNKNOWN',
  // Async and service-boundary relationships (item 5). Each names ONE hop of a chain that used to
  // be invisible, because "publishes a topic" and "an outbox row is relayed to a topic" are
  // different facts with different evidence and only one of them is a direct call.
  /** producer → outbox-record: the durable write that will later be relayed. */
  'RECORDED_IN',
  /** outbox-record/publisher → topic: the relay that turns a record into a published message. */
  'RELAYS_TO',
  /** topic/subscription → push-endpoint: the delivery target of a push subscription. */
  'DELIVERS_TO',
  /** consumer/handler → projection: the read model a consumed message maintains. */
  'PROJECTS_TO',
  // Contract relationships (items 6, 8).
  /** route/operation → contract document: this endpoint is declared by that document. */
  'SPECIFIED_BY',
  /** handler → openapi-operation: this code implements that declared operation. */
  'IMPLEMENTS_OPERATION',
  /** locale-bundle → translation-key: the bundle declares the key. */
  'DEFINES_KEY',
  /** code → translation-key: this code renders that key. */
  'RENDERS_KEY',
  // Field-level flow (item 7). Direction is always along the data's travel.
  /** field → field: the value reaches the target field. */
  'FLOWS_TO',
  /** field → field: same value, different name. */
  'RENAMED_TO',
  /** field → payload/contract: the field appears in that serialized form. */
  'SERIALIZED_AS',
  'DEPENDS_ON',
  'AFFECTS',
  'MAY_AFFECT',
  'CONTRADICTS',
  'SATISFIES',
  'REQUIRES',
  'DOCUMENTS',
  'GENERATED_FROM',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const isEdgeType = (value: unknown): value is EdgeType =>
  typeof value === 'string' && (EDGE_TYPES as readonly string[]).includes(value);
