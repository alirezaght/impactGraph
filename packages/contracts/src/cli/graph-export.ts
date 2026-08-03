import { z } from 'zod';

import { graphCategoryCountsSchema, graphRenderCategorySchema } from './graph-categories.js';
import { impactNodeFactsSchema, impactViewFactsSchema } from './impact-export.js';

export { graphRenderCategorySchema };

// `impactgraph graph --format json` / `export_graph_html` (PRD §18.3/§18.6, §20, §33) — the read
// model behind the self-contained HTML export, as data.
//
// One shape, two view sources: `architecture` (the current indexed graph) and `impact` (a stored
// analysis's blast radius). `kind` is the discriminant; `impact` carries the extra §18.5 payload and
// is present exactly when `kind` is `impact`.
//
// Deliberately absent from this contract: source text, evidence excerpts, line ranges and
// absolute paths. The document carries names, types, repository-relative paths, provenance and
// counts, which is exactly what the rendered file is allowed to contain.

/** Which view source produced the document. */
export const GRAPH_VIEW_KIND_KEYS = ['architecture', 'impact'] as const;

export const graphViewKindSchema = z.enum(GRAPH_VIEW_KIND_KEYS);

/** §18.4 current-vs-proposed. Emitted only for `proposed`; absent means a current relationship. */
export const graphEdgeStatusSchema = z.enum(['current', 'proposed']);

export const GRAPH_GROUPING_KEYS = ['context', 'application', 'package'] as const;

export const graphGroupingSchema = z.enum(GRAPH_GROUPING_KEYS);

export type GraphGroupingDto = z.infer<typeof graphGroupingSchema>;

const graphViewGroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Every graph node assigned to this group, at every level — not only the drawn ones. */
    totalNodes: z.number().int().min(0),
    shownNodes: z.number().int().min(0),
    hiddenNodes: z.number().int().min(0),
    countsByKnowledgeCategory: graphCategoryCountsSchema,
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
    /** Impact-view only: likelihood, confidence, hops and requirement attribution for this box. */
    impact: impactNodeFactsSchema.optional(),
    /** Impact-view only: a component an architectural option would create (§18.4). */
    proposed: z.literal(true).optional(),
  })
  .strict();

const graphViewEdgeSchema = z
  .object({
    sourceGroupId: z.string().min(1),
    targetGroupId: z.string().min(1),
    /** Aggregation never crosses categories, so this is a single value, never a mixture (§3). */
    knowledgeCategory: graphRenderCategorySchema,
    /** Emitted only for a proposed relationship; absent means current. Never a mixture (§18.4). */
    status: graphEdgeStatusSchema.optional(),
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
    kind: graphViewKindSchema,
    snapshotId: z.string().min(1),
    grouping: graphGroupingSchema,
    groups: z.array(graphViewGroupSchema),
    nodes: z.array(graphViewNodeSchema),
    edges: z.array(graphViewEdgeSchema),
    budget: graphBudgetSchema,
    edgeTotals: graphEdgeTotalsSchema,
    /** Present exactly when `kind` is `impact` — the §18.5 payload the diagram summarizes. */
    impact: impactViewFactsSchema.optional(),
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
