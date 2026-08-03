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
  'ROUTES_TO',
  'MIDDLEWARE_FOR',
  'REFERENCES_RESOURCE',
  'BINDS',
  /**
   * An unclassified relationship, named honestly rather than hidden inside USES. Traversable, may
   * contribute at most a `possible` tier, never corroborates, and carries no positive confidence.
   */
  'USES_UNKNOWN',
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
