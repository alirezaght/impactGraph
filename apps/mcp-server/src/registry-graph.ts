import { exportGraphHtmlFile } from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';
import type { GraphView } from '@impactgraph/workspace-engine';

// `export_graph_html` (§18.6/§21) — the only tool in the server that writes a non-configuration
// file. Three things it is careful about:
//   * the destination is confined to the analyzed workspace (`allowOutsideRoot: false`), because
//     an MCP client's working directory is arbitrary and the caller is an agent;
//   * it returns real counts, so the agent can report what it produced without reading the file
//     back — and cannot claim a complete picture when the §33 budget truncated one;
//   * for an impact export it also returns the COVERAGE numbers, so an agent cannot report a blast
//     radius while staying silent about requirements the analysis said nothing about.
//
// One tool, two views: `analysisId` selects the view source. A separate tool would have duplicated
// the write-confinement rule, the privacy contract, the budget reporting and the whole output shape
// in order to change a single input field.

/** Impact-only fields; absent for the architecture view rather than reported as zeroes. */
const impactFields = (view: GraphView): Record<string, unknown> => {
  const facts = view.impact;
  if (facts === undefined) {
    return {};
  }
  return {
    analysisId: facts.analysisId,
    analysisStatus: facts.analysisStatus,
    specificationId: facts.specificationId,
    specificationVersion: facts.specificationVersion,
    impacts: facts.totals.impactCount,
    requirementsWithImpacts: facts.totals.requirementsWithImpacts,
    requirementsTotal: facts.totals.requirementCount,
    requirementsWithoutImpacts: facts.totals.requirementsWithoutImpacts,
    snapshotMatchesAnalysis: facts.snapshotMatches,
    specificationStale: facts.specificationStale,
    proposedRelationships: facts.proposed?.relationships.length ?? 0,
  };
};

const graphHtml: ToolHandler<'export_graph_html'> = async (rootDir, input) => {
  const written = await exportGraphHtmlFile({
    rootDir,
    grouping: input.group ?? 'context',
    analysisId: input.analysisId,
    outPath: input.path,
    allowOutsideRoot: false,
  });
  if (!written.ok) {
    return written;
  }
  const view = written.value.view;
  return {
    ok: true,
    value: {
      path: written.value.path,
      byteSize: written.value.byteSize,
      view: view.kind,
      snapshotId: view.snapshotId,
      grouping: view.grouping,
      groups: view.budget.groupsShown,
      groupsTotal: view.budget.groups,
      nodesShown: view.budget.shownNodes,
      architectureNodes: view.budget.architectureNodes,
      nodesTotal: view.budget.graphNodes,
      relationships: view.edgeTotals.aggregatedShown,
      maxVisibleNodes: view.budget.maxVisibleNodes,
      truncated: view.budget.truncated || view.edgeTotals.truncated,
      ...impactFields(view),
    },
  };
};

export const GRAPH_HANDLERS = {
  export_graph_html: graphHtml,
} as const;
