import { z } from 'zod';

import { graphGroupingSchema } from '../cli/graph-export.js';

// §18.6/§21 — the agent-facing door to the same self-contained HTML architecture export the CLI
// writes. Unlike every other tool in the §Z7 read-only set, this one WRITES A FILE, so it says so
// in its description and its destination is confined to the analyzed workspace: an MCP client's
// working directory is arbitrary, and an agent must not be able to steer a write anywhere else.

export const GRAPH_EXPORT_TOOL_CONTRACTS = {
  export_graph_html: {
    description:
      'Render the current indexed architecture as one self-contained local HTML file (inline SVG, no JavaScript, no network requests, no remote assets) and report where it landed. Contains names, types, repository-relative paths, provenance and counts only — never source code and never evidence text — so the file is safe to attach to a ticket. Deterministic facts, AI-inferred interpretations and human-confirmed knowledge stay visually distinct without relying on colour (§3/§37), and the node budget of §33 is stated in the file rather than applied silently. Defaults to `impactgraph-graph.html` in the workspace root; `path` must stay inside the workspace. Writes one file into the workspace.',
    input: z
      .object({
        /** §18.4 grouping key. Defaults to `context`, falling back to the owning application. */
        group: graphGroupingSchema.optional(),
        /** Workspace-relative destination. Absolute paths and `..` escapes are rejected. */
        path: z.string().min(1).max(400).optional(),
      })
      .strict(),
    output: z
      .object({
        /** Absolute path of the written file, so the caller can tell the human where to look. */
        path: z.string().min(1),
        byteSize: z.number().int().min(0),
        snapshotId: z.string().min(1),
        grouping: graphGroupingSchema,
        /** Groups drawn, and how many exist — the two numbers a truncation claim needs. */
        groups: z.number().int().min(0),
        groupsTotal: z.number().int().min(0),
        /** Architecture-level component nodes drawn, of those eligible. */
        nodesShown: z.number().int().min(0),
        architectureNodes: z.number().int().min(0),
        /** Every node in the indexed graph, at every level (files, symbols, everything). */
        nodesTotal: z.number().int().min(0),
        relationships: z.number().int().min(0),
        maxVisibleNodes: z.number().int().min(1),
        /** True when the §33 budget hid something; the file names what it is not showing. */
        truncated: z.boolean(),
      })
      .strict(),
  },
} as const;
