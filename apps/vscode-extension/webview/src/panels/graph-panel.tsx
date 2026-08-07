import { useMemo, useState } from 'react';

import { planDisclosure } from '../graph/disclosure.js';
import { buildElements } from '../graph/elements.js';
import { DEFAULT_FILTERS, applyNodeFilters, evidenceBasesPresent } from '../graph/filters.js';
import { currentNodes, findProposal, structureNodes } from '../graph/proposed.js';

import { GraphCanvas } from './graph-canvas.js';
import { GraphControls } from './graph-controls.js';
import { DisclosureNotice } from './graph-disclosure.js';
import { NodeList } from './node-list.js';
import { ProposedList } from './proposed-list.js';

import type { DisclosurePlan } from '../graph/disclosure.js';
import type { GraphFilters } from '../graph/filters.js';
import type { ProposedSelection } from '../graph/proposed.js';
import type { WebviewRequest } from '../messaging.js';
import type { ImpactGraphDto, ImpactGraphNodeDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// Story 9.5 — §18.4 graph view. Nodes are filtered and capped BEFORE Cytoscape sees them (§33),
// and the node list beside the canvas is the keyboard/screen-reader equivalent (§37).

interface Props {
  readonly graph: ImpactGraphDto;
  readonly send: (request: WebviewRequest) => void;
  readonly selectedNodeId: string | undefined;
  readonly onSelect: (node: ImpactGraphNodeDto) => void;
  /** §18.4: selecting a proposal explains it from the DTO — no host round-trip, no new data. */
  readonly onSelectProposal: (selection: ProposedSelection) => void;
  readonly reducedMotion: boolean;
}

const EmptyGraph = (): JSX.Element => (
  <section className="panel panel--graph" aria-labelledby="graph-heading">
    <h2 id="graph-heading">Impact graph</h2>
    <p className="empty-state">
      No analysis yet. Enter a specification and run Analyze to populate the graph.
    </p>
  </section>
);

const GraphFooter = ({
  warnings,
  send,
}: {
  readonly warnings: readonly string[];
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => (
  <>
    <button
      type="button"
      onClick={() => {
        send({ type: 'webview/add-manual-impact', payload: {} });
      }}
    >
      Add missing impact
    </button>
    {warnings.map((warning) => (
      <p key={warning} className="warning" role="status">
        {warning}
      </p>
    ))}
  </>
);

interface ViewModel {
  readonly plan: DisclosurePlan;
  readonly elements: ReturnType<typeof buildElements>;
  readonly impactTypes: readonly string[];
  /** ADR-0015: bases present in the data — the evidence-basis facet's option list. */
  readonly evidenceBases: readonly string[];
}

const useGraphView = (
  graph: ImpactGraphDto,
  filters: GraphFilters,
  expanded: readonly string[],
): ViewModel => {
  const requirementLabels = useMemo(
    () => new Map(graph.requirements.map((entry) => [entry.id, entry.statement])),
    [graph.requirements],
  );
  const impactTypes = useMemo(
    () =>
      [
        ...new Set(
          graph.nodes.flatMap((node) => (node.impactType === undefined ? [] : [node.impactType])),
        ),
      ].sort(),
    [graph.nodes],
  );
  const evidenceBases = useMemo(() => evidenceBasesPresent(graph.nodes), [graph.nodes]);
  const plan = useMemo(
    () =>
      planDisclosure({
        // §18.4: the structure view decides WHICH halves enter the pipeline; both by default.
        // Proposed components go in with the current ones, so they count against the §33 budget.
        nodes: applyNodeFilters(structureNodes(graph, filters.structure), filters),
        filters,
        requirementLabels,
        expandedGroupIds: new Set(expanded),
      }),
    [graph, filters, requirementLabels, expanded],
  );
  const elements = useMemo(
    () => buildElements({ graph, plan, filters, requirementLabels }),
    [graph, plan, filters, requirementLabels],
  );
  return { plan, elements, impactTypes, evidenceBases };
};

/**
 * A tapped canvas element is either a proposal or a current node — never silently the other.
 * Proposals are resolved from the DTO the host already sent; current nodes go through the
 * existing `webview/select-node` request, because only the host can explain a real component.
 */
const selectHandler =
  (input: {
    readonly graph: ImpactGraphDto;
    readonly plan: DisclosurePlan;
    readonly onSelect: (node: ImpactGraphNodeDto) => void;
    readonly onSelectProposal: (selection: ProposedSelection) => void;
  }) =>
  (elementId: string): void => {
    const proposal = findProposal(input.graph, elementId);
    if (proposal !== undefined) {
      input.onSelectProposal(proposal);
      return;
    }
    const node = currentNodes(input.plan.visibleNodes).find(
      (candidate) => candidate.id === elementId,
    );
    if (node !== undefined) {
      input.onSelect(node);
    }
  };

export const GraphPanel = ({
  graph,
  send,
  selectedNodeId,
  onSelect,
  onSelectProposal,
  reducedMotion,
}: Props): JSX.Element => {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const { plan, elements, impactTypes, evidenceBases } = useGraphView(graph, filters, expanded);

  const selectElement = selectHandler({ graph, plan, onSelect, onSelectProposal });

  if (graph.status === 'empty') {
    return <EmptyGraph />;
  }
  return (
    <section className="panel panel--graph" aria-labelledby="graph-heading">
      <h2 id="graph-heading">Impact graph</h2>
      <DisclosureNotice
        plan={plan}
        totalNodeCount={graph.totalNodeCount}
        expandedGroupIds={expanded}
        onToggleGroup={(groupId) => {
          setExpanded(
            expanded.includes(groupId)
              ? expanded.filter((id) => id !== groupId)
              : [...expanded, groupId],
          );
        }}
      />
      <GraphControls
        filters={filters}
        impactTypes={impactTypes}
        evidenceTypes={evidenceBases}
        onChange={setFilters}
      />
      <GraphCanvas
        elements={elements}
        reducedMotion={reducedMotion}
        onSelect={selectElement}
        onSelectEdge={selectElement}
      />
      <NodeList
        nodes={currentNodes(plan.visibleNodes)}
        analysisId={graph.analysisId}
        selectedNodeId={selectedNodeId}
        onSelect={onSelect}
        send={send}
      />
      <ProposedList
        structure={graph.proposedStructure}
        view={filters.structure}
        selectedId={selectedNodeId}
        onSelect={onSelectProposal}
      />
      <GraphFooter warnings={graph.warnings} send={send} />
    </section>
  );
};
