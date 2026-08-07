import { ConfidenceText, KnowledgeBadge, TierCapMarker } from '../components/badges.js';

import type { WebviewRequest } from '../messaging.js';
import type { ImpactGraphNodeDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §37 tree parity: everything the canvas shows is also a focusable, screen-reader-readable list
// item here — the graph is never the only access path. Enter/click opens the evidence panel.

interface Props {
  readonly nodes: readonly ImpactGraphNodeDto[];
  readonly analysisId: string | undefined;
  readonly selectedNodeId: string | undefined;
  readonly onSelect: (node: ImpactGraphNodeDto) => void;
  readonly send: (request: WebviewRequest) => void;
}

const DecisionButtons = ({
  node,
  analysisId,
  send,
}: {
  readonly node: ImpactGraphNodeDto;
  readonly analysisId: string;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => (
  <span className="node-row__decisions">
    {(['accepted', 'rejected'] as const).map((decision) => (
      <button
        key={decision}
        type="button"
        onClick={() => {
          send({
            type: 'webview/impact-decision',
            payload: {
              analysisId,
              requirementId: node.requirementIds[0] ?? '',
              nodeId: node.id,
              decision,
            },
          });
        }}
      >
        {decision === 'accepted' ? 'Accept' : 'Reject'}
      </button>
    ))}
  </span>
);

/**
 * ADR-0015: WHY the impact was selected, as compact TEXT — the primary (strongest-first) basis
 * plus a count, with the full set on the accessible label. An absent basis is said out loud,
 * never defaulted. Rendered apart from the §3 knowledge badge: basis is an attribute WITHIN
 * deterministic knowledge, not a fourth category.
 */
const EvidenceBasisText = ({
  types,
}: {
  readonly types?: readonly string[] | undefined;
}): JSX.Element => {
  if (types === undefined || types.length === 0) {
    return (
      <span className="node-row__basis" aria-label="Evidence basis not reported by the analysis">
        basis: not reported
      </span>
    );
  }
  const rest = types.length - 1;
  return (
    <span
      className="node-row__basis"
      data-evidence-types={types.join(' ')}
      title={types.join(', ')}
      aria-label={`Evidence basis: ${types.join(', ')}`}
    >
      basis: {types[0]}
      {rest > 0 ? ` +${String(rest)}` : ''}
    </span>
  );
};

const summaryOf = (node: ImpactGraphNodeDto): string =>
  node.kind === 'impact'
    ? `${node.likelihood ?? 'no likelihood'} · ${node.impactType ?? 'no impact type'} · ${node.directness ?? 'directness not reported'}`
    : 'dependency-path node';

const NodeRow = ({
  node,
  analysisId,
  selected,
  onSelect,
  send,
}: {
  readonly node: ImpactGraphNodeDto;
  readonly analysisId: string | undefined;
  readonly selected: boolean;
  readonly onSelect: (node: ImpactGraphNodeDto) => void;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => (
  <li
    className="node-row"
    data-node-id={node.id}
    data-kind={node.kind}
    data-directness={node.directness ?? 'unknown'}
    aria-current={selected ? 'true' : undefined}
  >
    <button
      type="button"
      className="node-row__select"
      onClick={() => {
        onSelect(node);
      }}
    >
      {node.name}
    </button>
    <KnowledgeBadge provenance={node.provenance} category={node.knowledgeCategory} />
    <span className="node-row__meta">{summaryOf(node)}</span>
    {node.kind === 'impact' ? (
      <>
        <EvidenceBasisText types={node.evidenceTypes} />
        <TierCapMarker cappedBy={node.tierCappedBy} />
      </>
    ) : null}
    <ConfidenceText confidence={node.confidence} />
    {node.filePath === undefined ? null : (
      <button
        type="button"
        className="node-row__open"
        onClick={() => {
          send({ type: 'webview/open-source', payload: { path: node.filePath ?? '' } });
        }}
      >
        Open {node.filePath}
      </button>
    )}
    {analysisId === undefined || node.kind !== 'impact' ? null : (
      <DecisionButtons node={node} analysisId={analysisId} send={send} />
    )}
  </li>
);

export const NodeList = ({
  nodes,
  analysisId,
  selectedNodeId,
  onSelect,
  send,
}: Props): JSX.Element => {
  if (nodes.length === 0) {
    return <p className="empty-state">No nodes match the current filters.</p>;
  }
  return (
    <ul className="node-list" aria-label="Impacted components (keyboard equivalent of the graph)">
      {nodes.map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          analysisId={analysisId}
          selected={selectedNodeId === node.id}
          onSelect={onSelect}
          send={send}
        />
      ))}
    </ul>
  );
};
