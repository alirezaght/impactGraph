import { z } from 'zod';

import { knowledgeEnvelopeSchema } from './knowledge.js';

// Persisted graph-record artifacts: nodes at schemaVersion 2, edges at 1 (PRD §12, §28;
// ADR-0006/0009).
// Node category/type and edge type are open strings at this boundary — the exact PRD §12
// vocabulary (and category/type pairing) is enforced by packages/domain on read/write, so
// adding a vocabulary entry is not a breaking schema change (enum-expansion rule).

const routeParameterSchema = z.object({ name: z.string().min(1), required: z.boolean() }).strict();

/**
 * §12.1.1 route contract. Typed rather than a generic metadata bag: an untyped record would avoid
 * this version bump today and push every validation problem downstream instead.
 */
export const routeContractSchema = z
  .object({
    path: z.string().min(1),
    method: z.string().min(1).optional(),
    pathParameters: z.array(routeParameterSchema),
    queryParameters: z.array(routeParameterSchema),
  })
  .strict();

/** Version 1 nodes, still readable. Retained solely so the upgrader has something to accept. */
const graphNodeArtifactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    category: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    knowledge: knowledgeEnvelopeSchema,
  })
  .strict();

/**
 * Version 2 adds the route contract. A node gains semantically meaningful persisted state, so this
 * is a version bump rather than an additive optional field: a reader that ignored `route` would
 * silently treat a route node as having no contract, which is a different claim from "unknown".
 */
export const graphNodeArtifactSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    category: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    route: routeContractSchema.optional(),
    knowledge: knowledgeEnvelopeSchema,
  })
  .strict();

export interface GraphNodeUpgrade {
  readonly node: z.infer<typeof graphNodeArtifactSchema>;
  /** Present when the upgrade could not establish something a v2 writer would have recorded. */
  readonly diagnostic?: string;
}

/** `GET /api/deals` → verb + path, for MIGRATION ONLY. Never call this on a v2 node. */
const legacyRouteName = (name: string): { method: string; path: string } | undefined => {
  const space = name.indexOf(' ');
  if (space <= 0) {
    return undefined;
  }
  const path = name.slice(space + 1);
  const method = name.slice(0, space);
  return path.startsWith('/') && method === method.toUpperCase() ? { method, path } : undefined;
};

/**
 * Upgrade a persisted v1 node to v2.
 *
 * For a route node whose name parses, verb and path are recovered — that information genuinely was
 * in the artifact, just in the wrong place. Parameters are left EMPTY rather than derived: a v1
 * artifact never contained parameter evidence, and inventing `pathParameters: []` as though it were
 * observed would let a later rule read "no required parameters" out of an absence of data. A node
 * whose name does not parse keeps its identity, gets no route, and reports a diagnostic.
 */
export const upgradeGraphNodeArtifact = (input: unknown): GraphNodeUpgrade | undefined => {
  const v2 = graphNodeArtifactSchema.safeParse(input);
  if (v2.success) {
    return { node: v2.data };
  }
  const v1 = graphNodeArtifactV1Schema.safeParse(input);
  if (!v1.success) {
    return undefined;
  }
  const rest = { ...v1.data, schemaVersion: 2 as const };
  if (rest.type !== 'api-endpoint') {
    return { node: rest };
  }
  const parsed = legacyRouteName(rest.name);
  if (parsed === undefined) {
    return {
      node: rest,
      diagnostic: `route node '${rest.id}' has a name that does not parse as '<VERB> <path>', so no route contract could be recovered`,
    };
  }
  return {
    node: {
      ...rest,
      route: {
        path: parsed.path,
        method: parsed.method,
        pathParameters: [],
        queryParameters: [],
      },
    },
    diagnostic: `route node '${rest.id}' upgraded from its display name; parameter evidence was never recorded at v1 and is left empty rather than assumed absent`,
  };
};

export const graphEdgeArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    type: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    knowledge: knowledgeEnvelopeSchema,
  })
  .strict();

export type GraphNodeArtifactDto = z.infer<typeof graphNodeArtifactSchema>;
export type GraphEdgeArtifactDto = z.infer<typeof graphEdgeArtifactSchema>;
