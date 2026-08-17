import { z } from 'zod';

import { graphGroupingSchema, graphViewKindSchema } from '../cli/graph-export.js';

// §18.6/§21 — the agent-facing door to the same self-contained HTML export the CLI writes. Unlike
// every other tool in the §Z7 read-only set, this one WRITES A FILE, so it says so in its
// description and its destination is confined to the analyzed workspace: an MCP client's working
// directory is arbitrary, and an agent must not be able to steer a write anywhere else.
//
// ONE tool, two views. `analysisId` selects the view source rather than a second tool existing:
// the write-confinement rule, the privacy contract, the node budget and the whole output shape are
// identical either way, so a 41st tool would duplicate all of it to change one input field.

export const GRAPH_EXPORT_TOOL_CONTRACTS = {
  export_graph_html: {
    description:
      'Render the repository as one self-contained local HTML file (inline SVG, no JavaScript, no network requests, no remote assets) and report where it landed. Without `analysisId` it renders the CURRENT INDEXED ARCHITECTURE. With `analysisId` it renders that stored impact analysis instead: the components a specification is predicted to touch, grouped the same way, with likelihood as the primary signal, confidence and its contributing signals, dependency-path hop counts, and requirement attribution. Contains names, types, repository-relative paths, provenance, requirement text and counts only — never source code, never evidence text, never evidence line ranges — so the file is safe to attach to a ticket. Deterministic facts, AI-inferred interpretations and human-confirmed knowledge stay visually distinct without relying on colour (§3/§37); likelihood is readable without colour too; proposed structure is never merged with current structure (§18.4); and the node budget of §33 is stated in the file rather than applied silently. Defaults to `impactgraph-graph.html` (architecture) or `impactgraph-impact.html` (impact) in the workspace root; `path` must stay inside the workspace. Writes one file into the workspace.',
    input: z
      .object({
        /** §18.4 grouping key. Defaults to `context`, falling back to the owning application. */
        group: graphGroupingSchema.optional(),
        /**
         * Stored analysis to render. Omit for the current architecture. An unknown id fails with a
         * configuration error that names the ids that would have worked — use `list_analyses`.
         */
        analysisId: z.string().min(1).max(200).optional(),
        /** ADR-0022: with an analysisId, 'decision' (default) draws only the surfaces worth
         *  acting on; 'impact' restores the every-surface diagram. */
        view: z.enum(['decision', 'impact']).optional(),
        /** Workspace-relative destination. Absolute paths and `..` escapes are rejected. */
        path: z.string().min(1).max(400).optional(),
      })
      .strict(),
    output: z
      .object({
        /** Absolute path of the written file, so the caller can tell the human where to look. */
        path: z.string().min(1),
        byteSize: z.number().int().min(0),
        /** Which view was rendered — never inferred by the caller from its own input. */
        view: graphViewKindSchema,
        snapshotId: z.string().min(1),
        grouping: graphGroupingSchema,
        /** Groups drawn, and how many exist — the two numbers a truncation claim needs. */
        groups: z.number().int().min(0),
        groupsTotal: z.number().int().min(0),
        /** Component nodes drawn, of those eligible. */
        nodesShown: z.number().int().min(0),
        architectureNodes: z.number().int().min(0),
        /** Every node in the resolved graph, at every level (files, symbols, everything). */
        nodesTotal: z.number().int().min(0),
        relationships: z.number().int().min(0),
        maxVisibleNodes: z.number().int().min(1),
        /** True when the §33 budget hid something; the file names what it is not showing. */
        truncated: z.boolean(),
        // --- impact view only; absent for the architecture view ---------------------------------
        analysisId: z.string().min(1).optional(),
        analysisStatus: z.string().min(1).optional(),
        specificationId: z.string().min(1).optional(),
        specificationVersion: z.number().int().min(1).optional(),
        /** Impacts in the analysis — every one is listed in the file, drawn or not. */
        impacts: z.number().int().min(0).optional(),
        requirementsWithImpacts: z.number().int().min(0).optional(),
        requirementsTotal: z.number().int().min(0).optional(),
        /** Requirements the analysis said nothing about — a gap the agent must not paper over. */
        requirementsWithoutImpacts: z.number().int().min(0).optional(),
        /** False when component names were resolved against a different snapshot (§40.2). */
        snapshotMatchesAnalysis: z.boolean().optional(),
        specificationStale: z.boolean().optional(),
        proposedRelationships: z.number().int().min(0).optional(),
      })
      .strict(),
  },
} as const;
