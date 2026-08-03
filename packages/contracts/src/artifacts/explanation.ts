import { z } from 'zod';

import { effectiveComponentSchema, effectiveRelationshipSchema } from '../config/overlay.js';

import { provenanceSchema } from './knowledge.js';

import type { ProvenanceDto } from './knowledge.js';

// §18.5 explanation payloads — ONE source of truth shared by the MCP tool contracts (§21) and
// the webview evidence panel. Provenance plus the derived knowledge category keep deterministic
// facts, AI inferences, and human-confirmed knowledge distinct (§3) wherever they are rendered.
//
// The field shapes are deliberately unchanged from their previous home in tools/tools.ts: the
// generated tool JSON Schemas must stay byte-identical (no contract version bump here).

export const KNOWLEDGE_CATEGORIES = [
  'deterministic',
  'ai-inferred',
  'human-confirmed',
  'reserved',
] as const;

export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES);

export type KnowledgeCategoryDto = z.infer<typeof knowledgeCategorySchema>;

/**
 * Mirror of the domain mapping (PRD §12.3, ADR-0002). Contracts may not import domain, so the
 * table is duplicated here and pinned by `domain-alignment.test.ts` — if domain ever changes a
 * category, that test fails rather than the UI silently mislabelling a knowledge category.
 */
const CATEGORY_BY_PROVENANCE: Readonly<Record<ProvenanceDto, KnowledgeCategoryDto>> = {
  'static-analysis': 'deterministic',
  configuration: 'deterministic',
  'git-history': 'deterministic',
  'framework-convention': 'deterministic',
  'llm-inferred': 'ai-inferred',
  'human-confirmed': 'human-confirmed',
  'runtime-observation': 'reserved',
};

/**
 * Category for a provenance string, or `undefined` when the value is not a known provenance.
 * Callers must render the unknown case explicitly (§43.6) — never as "deterministic".
 */
export const knowledgeCategoryForProvenance = (
  provenance: string | undefined,
): KnowledgeCategoryDto | undefined => {
  const parsed = provenanceSchema.safeParse(provenance);
  return parsed.success ? CATEGORY_BY_PROVENANCE[parsed.data] : undefined;
};

export const evidenceRangeSchema = z
  .object({
    startLine: z.number().int().min(0),
    startColumn: z.number().int().min(0),
    endLine: z.number().int().min(0),
    endColumn: z.number().int().min(0),
  })
  .strict();

/** §18.5 mirror: provenance + derived knowledge category keep facts and inferences distinct (§3). */
export const knowledgeExplanationSchema = z
  .object({
    provenance: z.string().min(1),
    knowledgeCategory: z.string().min(1),
    confidence: z.number().min(0).max(1),
    confidenceSignals: z.array(
      z.object({ type: z.string().min(1), contribution: z.number() }).strict(),
    ),
    evidence: z.array(
      z
        .object({
          id: z.string().min(1),
          source: z.string().min(1),
          /** §40.4: declaration range, present when the evidence is a file range. */
          range: evidenceRangeSchema.optional(),
        })
        .strict(),
    ),
    repositorySnapshotId: z.string().min(1),
    analysisRunId: z.string().min(1),
  })
  .strict();

export const nodeExplanationSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    type: z.string().min(1),
    path: z.string().min(1).optional(),
    knowledge: knowledgeExplanationSchema,
    incomingEdges: z.array(
      z
        .object({
          edgeId: z.string().min(1),
          type: z.string().min(1),
          from: z.string().min(1),
          fromName: z.string().min(1),
        })
        .strict(),
    ),
    outgoingEdges: z.array(
      z
        .object({
          edgeId: z.string().min(1),
          type: z.string().min(1),
          to: z.string().min(1),
          toName: z.string().min(1),
        })
        .strict(),
    ),
    /** §16/§Z5 read-time overlay: the effective name/role/context/markers and which level won. */
    effective: effectiveComponentSchema.optional(),
  })
  .strict();

export const edgeExplanationSchema = z
  .object({
    edgeId: z.string().min(1),
    type: z.string().min(1),
    source: z.object({ nodeId: z.string().min(1), name: z.string().min(1) }).strict(),
    target: z.object({ nodeId: z.string().min(1), name: z.string().min(1) }).strict(),
    knowledge: knowledgeExplanationSchema,
    /** §16 confirm/reject overlay — a rejected edge is reported as excluded, never dropped. */
    effective: effectiveRelationshipSchema.optional(),
  })
  .strict();

export type KnowledgeExplanationDto = z.infer<typeof knowledgeExplanationSchema>;
export type NodeExplanationDto = z.infer<typeof nodeExplanationSchema>;
export type EdgeExplanationDto = z.infer<typeof edgeExplanationSchema>;
export type EvidenceRangeDto = z.infer<typeof evidenceRangeSchema>;
