import { z } from 'zod';

import { knowledgeEnvelopeSchema } from './knowledge.js';

// Persisted graph-record artifacts: nodes at schemaVersion 3, edges at 1 (PRD §12, §28;
// ADR-0006/0009).
// Node category/type and edge type are open strings at this boundary — the exact PRD §12
// vocabulary (and category/type pairing) is enforced by packages/domain on read/write, so
// adding a vocabulary entry is not a breaking schema change (enum-expansion rule).

/**
 * §12.1.1 route parameters. Three-state, because a producer usually observes that a segment is
 * dynamic without observing whether it may be omitted — `{id}` in Spring and FastAPI says nothing
 * about requiredness. `unknown` is the honest value there, and a boolean could not express it.
 */
const routeParameterSchema = z
  .object({
    name: z.string().min(1),
    requiredness: z.enum(['required', 'optional', 'unknown']),
  })
  .strict();

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

const nodeFields = {
  id: z.string().min(1),
  category: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1).optional(),
  knowledge: knowledgeEnvelopeSchema,
};

/** Version 1 nodes, still readable. Retained solely so the upgrader has something to accept. */
const graphNodeArtifactV1Schema = z.object({ schemaVersion: z.literal(1), ...nodeFields }).strict();

/** Version 2 nodes: route contracts existed, but requiredness was a boolean. */
const graphNodeArtifactV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...nodeFields,
    route: z
      .object({
        path: z.string().min(1),
        method: z.string().min(1).optional(),
        pathParameters: z.array(
          z.object({ name: z.string().min(1), required: z.boolean() }).strict(),
        ),
        queryParameters: z.array(
          z.object({ name: z.string().min(1), required: z.boolean() }).strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Version 2 added the route contract; version 3 makes parameter requiredness three-state.
 *
 * Both are version bumps rather than additive optional fields. A reader that ignored `route` would
 * silently treat a route node as having no contract, which is a different claim from "unknown"; and
 * a reader that expected `required: boolean` cannot represent an observed-dynamic-but-unknown
 * parameter at all, so the field had to change shape rather than gain a sibling.
 */
export const graphNodeArtifactSchema = z
  .object({
    schemaVersion: z.literal(3),
    ...nodeFields,
    route: routeContractSchema.optional(),
    /**
     * ADR-0020 §3 — the member's declared type, verbatim. Additive rather than a version bump:
     * a reader that ignores it makes no wrong claim (absent means "not stated", and no rule may
     * read anything out of absence), unlike `route`, where ignoring the field changed a claim.
     */
    declaredType: z.string().min(1).optional(),
    knowledge: knowledgeEnvelopeSchema,
  })
  .strict();

export interface GraphNodeUpgrade {
  readonly node: z.infer<typeof graphNodeArtifactSchema>;
  /** Present when the upgrade could not establish something a current writer would have recorded. */
  readonly diagnostic?: string;
}

/** `GET /api/deals` → verb + path, for MIGRATION ONLY. Never call this on a current node. */
const legacyRouteName = (name: string): { method: string; path: string } | undefined => {
  const space = name.indexOf(' ');
  if (space <= 0) {
    return undefined;
  }
  const path = name.slice(space + 1);
  const method = name.slice(0, space);
  return path.startsWith('/') && method === method.toUpperCase() ? { method, path } : undefined;
};

type V2Parameter = { readonly name: string; readonly required: boolean };

/**
 * v2 `required: false` becomes `unknown`, not `optional`.
 *
 * No v2 producer ever set the flag — every persisted array was empty — so `false` was the default
 * value of a field nothing wrote, never an observation that a parameter could be omitted. Mapping it
 * to `optional` would convert a shape requirement into evidence, which is exactly the failure this
 * three-state type exists to prevent. `true` maps to `required` because only a deliberate write
 * could have produced it.
 */
const liftParameters = (
  parameters: readonly V2Parameter[],
): { name: string; requiredness: 'required' | 'unknown' }[] =>
  parameters.map((parameter) => ({
    name: parameter.name,
    requiredness: parameter.required ? ('required' as const) : ('unknown' as const),
  }));

const upgradeFromV2 = (node: z.infer<typeof graphNodeArtifactV2Schema>): GraphNodeUpgrade => {
  const rest = { ...node, schemaVersion: 3 as const };
  if (rest.route === undefined) {
    return { node: { ...rest, route: undefined } };
  }
  const relaxed = [...rest.route.pathParameters, ...rest.route.queryParameters].some(
    (parameter) => !parameter.required,
  );
  const upgrade: GraphNodeUpgrade = {
    node: {
      ...rest,
      route: {
        ...rest.route,
        pathParameters: liftParameters(rest.route.pathParameters),
        queryParameters: liftParameters(rest.route.queryParameters),
      },
    },
  };
  return relaxed
    ? {
        ...upgrade,
        diagnostic: `route node '${rest.id}' had parameters marked not-required at v2, which recorded no observation; they are upgraded to 'unknown' rather than 'optional'`,
      }
    : upgrade;
};

/**
 * Upgrade a persisted v1 or v2 node to the current version.
 *
 * For a v1 route node whose name parses, verb and path are recovered — that information genuinely
 * was in the artifact, just in the wrong place. Parameters are left EMPTY rather than derived: a v1
 * artifact never contained parameter evidence, and inventing `pathParameters: []` as though it were
 * observed would let a later rule read "no required parameters" out of an absence of data. A node
 * whose name does not parse keeps its identity, gets no route, and reports a diagnostic.
 */
export const upgradeGraphNodeArtifact = (input: unknown): GraphNodeUpgrade | undefined => {
  const current = graphNodeArtifactSchema.safeParse(input);
  if (current.success) {
    return { node: current.data };
  }
  const v2 = graphNodeArtifactV2Schema.safeParse(input);
  if (v2.success) {
    return upgradeFromV2(v2.data);
  }
  const v1 = graphNodeArtifactV1Schema.safeParse(input);
  if (!v1.success) {
    return undefined;
  }
  const rest = { ...v1.data, schemaVersion: 3 as const };
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
      route: { path: parsed.path, method: parsed.method, pathParameters: [], queryParameters: [] },
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
