import { z } from 'zod';

import { KNOWLEDGE_CATEGORIES } from '../artifacts/explanation.js';

// `impactgraph graph --format json` / `export_graph_html` (PRD §18.3/§18.6, §20, §33) — the
// architecture read model behind the self-contained HTML export, as data.
//
// Deliberately absent from this contract: source text, evidence excerpts, line ranges and
// absolute paths. The document carries names, types, repository-relative paths, provenance and
// counts, which is exactly what the rendered file is allowed to contain.

export const GRAPH_GROUPING_KEYS = ['context', 'application', 'package'] as const;

export const graphGroupingSchema = z.enum(GRAPH_GROUPING_KEYS);

export type GraphGroupingDto = z.infer<typeof graphGroupingSchema>;

/**
 * The four §12.3 knowledge categories plus an explicit `unknown`. §43.6: an unrecognized
 * provenance must be rendered as unknown, never silently defaulted to "deterministic".
 */
export const graphRenderCategorySchema = z.enum([...KNOWLEDGE_CATEGORIES, 'unknown'] as const);

const categoryCountsSchema = z
  .object({
    deterministic: z.number().int().min(0),
    'ai-inferred': z.number().int().min(0),
    'human-confirmed': z.number().int().min(0),
    reserved: z.number().int().min(0),
    unknown: z.number().int().min(0),
  })
  .strict();

const graphViewGroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Every graph node assigned to this group, at every level — not only the drawn ones. */
    totalNodes: z.number().int().min(0),
    shownNodes: z.number().int().min(0),
    hiddenNodes: z.number().int().min(0),
    countsByKnowledgeCategory: categoryCountsSchema,
  })
  .strict();

const graphViewNodeSchema = z
  .object({
    id: z.string().min(1),
    groupId: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    category: z.string().min(1),
    /** Repository-relative. Absolute paths never enter this document. */
    path: z.string().min(1).optional(),
    provenance: z.string().min(1),
    knowledgeCategory: graphRenderCategorySchema,
  })
  .strict();

const graphViewEdgeSchema = z
  .object({
    sourceGroupId: z.string().min(1),
    targetGroupId: z.string().min(1),
    /** Aggregation never crosses categories, so this is a single value, never a mixture (§3). */
    knowledgeCategory: graphRenderCategorySchema,
    kinds: z.array(z.object({ type: z.string().min(1), count: z.number().int().min(1) }).strict()),
    count: z.number().int().min(1),
  })
  .strict();

const graphBudgetSchema = z
  .object({
    maxVisibleNodes: z.number().int().min(1),
    graphNodes: z.number().int().min(0),
    architectureNodes: z.number().int().min(0),
    shownNodes: z.number().int().min(0),
    hiddenNodes: z.number().int().min(0),
    groups: z.number().int().min(0),
    groupsShown: z.number().int().min(0),
    groupsHidden: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

const graphEdgeTotalsSchema = z
  .object({
    graphEdges: z.number().int().min(0),
    containment: z.number().int().min(0),
    intraGroup: z.number().int().min(0),
    interGroup: z.number().int().min(0),
    aggregated: z.number().int().min(0),
    aggregatedShown: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

export const graphViewSchema = z
  .object({
    snapshotId: z.string().min(1),
    grouping: graphGroupingSchema,
    groups: z.array(graphViewGroupSchema),
    nodes: z.array(graphViewNodeSchema),
    edges: z.array(graphViewEdgeSchema),
    budget: graphBudgetSchema,
    edgeTotals: graphEdgeTotalsSchema,
  })
  .strict();

export const cliGraphOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('graph'),
    /** Set when the run also wrote the HTML file; absent for `--format json` alone. */
    writtenPath: z.string().min(1).optional(),
    byteSize: z.number().int().min(0).optional(),
    view: graphViewSchema,
  })
  .strict();

export type CliGraphOutput = z.infer<typeof cliGraphOutputSchema>;
export type GraphViewDto = z.infer<typeof graphViewSchema>;
