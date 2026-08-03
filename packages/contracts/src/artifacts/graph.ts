import { z } from 'zod';

import { knowledgeEnvelopeSchema } from './knowledge.js';

// Persisted graph-record artifacts, schemaVersion 1 (PRD §12, §28; ADR-0006/0009).
// Node category/type and edge type are open strings at this boundary — the exact PRD §12
// vocabulary (and category/type pairing) is enforced by packages/domain on read/write, so
// adding a vocabulary entry is not a breaking schema change (enum-expansion rule).

export const graphNodeArtifactSchema = z
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
