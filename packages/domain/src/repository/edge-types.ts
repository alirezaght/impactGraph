// PRD §12.2 — the edge-type roster, verbatim and in PRD order.
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
