import { KnowledgeBadge } from '../components/badges.js';

import {
  ConfidenceSignals,
  DecisionList,
  EvidenceRecords,
  ImpactSummary,
  SourceList,
} from './evidence-sections.js';

import type { WebviewRequest } from '../messaging.js';
import type { EvidencePanelStateDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// Story 9.3 — §18.5 evidence panel, bound to the current graph/list selection.

interface Props {
  readonly state: EvidencePanelStateDto;
  readonly send: (request: WebviewRequest) => void;
}

const DecisionActions = ({ state, send }: Props): JSX.Element | null => {
  const impact = state.impact;
  const nodeId = state.target?.nodeId;
  if (impact === undefined || nodeId === undefined) {
    return null;
  }
  const base = { analysisId: impact.analysisId, requirementId: impact.requirementId, nodeId };
  return (
    <div className="actions">
      <button
        type="button"
        onClick={() => {
          send({ type: 'webview/impact-decision', payload: { ...base, decision: 'accepted' } });
        }}
      >
        Accept impact
      </button>
      <button
        type="button"
        onClick={() => {
          send({ type: 'webview/impact-decision', payload: { ...base, decision: 'rejected' } });
        }}
      >
        Reject impact
      </button>
    </div>
  );
};

const NotLoaded = ({ state }: Pick<Props, 'state'>): JSX.Element => (
  <section className="panel panel--evidence" aria-labelledby="evidence-heading">
    <h2 id="evidence-heading">Evidence</h2>
    <p className="empty-state" role="status" data-status={state.status}>
      {state.message ?? (state.status === 'loading' ? 'Loading evidence…' : 'No selection.')}
    </p>
  </section>
);

const TargetHeading = ({ state }: Pick<Props, 'state'>): JSX.Element => (
  <>
    <h3 className="evidence__target">
      {state.target?.name ?? 'selection'}{' '}
      <KnowledgeBadge
        provenance={state.explanation?.knowledge.provenance ?? state.impact?.provenance}
      />
    </h3>
    {state.target?.path === undefined ? null : (
      <p className="evidence__path">{state.target.path}</p>
    )}
  </>
);

export const EvidencePanel = ({ state, send }: Props): JSX.Element => {
  if (state.status !== 'loaded') {
    return <NotLoaded state={state} />;
  }
  return (
    <section className="panel panel--evidence" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Evidence</h2>
      <TargetHeading state={state} />
      <ImpactSummary impact={state.impact} />
      <h4>Why this confidence (§14)</h4>
      <ConfidenceSignals explanation={state.explanation} />
      <h4>Source files</h4>
      <SourceList title="Source files" files={state.impact?.evidenceFiles ?? []} send={send} />
      <h4>Related tests</h4>
      <SourceList title="Related tests" files={state.impact?.relatedTests ?? []} send={send} />
      <h4>Evidence records</h4>
      <EvidenceRecords explanation={state.explanation} send={send} />
      <h4>Human decisions</h4>
      <DecisionList decisions={state.humanDecisions} />
      <DecisionActions state={state} send={send} />
      {state.warnings.map((warning) => (
        <p key={warning} className="warning" role="status">
          {warning}
        </p>
      ))}
    </section>
  );
};
