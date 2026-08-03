import { useCallback, useEffect, useReducer, useState } from 'react';

import { postToHost, subscribeToHost } from './messaging.js';
import { EvidencePanel } from './panels/evidence-panel.js';
import { GraphPanel } from './panels/graph-panel.js';
import { ProposedEvidencePanel } from './panels/proposed-evidence.js';
import { SpecificationPanel } from './panels/specification-panel.js';
import { INITIAL_STATE, reduce } from './state.js';

import type { ProposedSelection } from './graph/proposed.js';
import type { WebviewRequest } from './messaging.js';
import type { AppAction, AppState } from './state.js';
import type { ImpactGraphNodeDto } from '@impactgraph/contracts';
import type { Dispatch, JSX } from 'react';

// The review surface: specification (§18.2) + impact graph (§18.4) + evidence (§18.5). The
// webview renders host state and posts intent; it decides nothing about the analysis itself.

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ErrorBanner = ({
  errors,
  onDismiss,
}: {
  readonly errors: readonly string[];
  readonly onDismiss: () => void;
}): JSX.Element | null =>
  errors.length === 0 ? null : (
    <div className="errors" role="alert">
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );

const useHostChannel = (dispatch: Dispatch<AppAction>): ((request: WebviewRequest) => void) => {
  useEffect(() => {
    const unsubscribe = subscribeToHost({
      onMessage: (message) => {
        dispatch({ kind: 'host', message });
      },
      onInvalid: (error) => {
        dispatch({ kind: 'local-error', message: `${error.code}: ${error.message}` });
      },
    });
    postToHost({ type: 'webview/ready', payload: {} });
    return unsubscribe;
  }, [dispatch]);

  return useCallback(
    (request: WebviewRequest): void => {
      const failure = postToHost(request);
      if (failure !== undefined) {
        dispatch({ kind: 'local-error', message: `${failure.code}: ${failure.message}` });
      }
    },
    [dispatch],
  );
};

interface ColumnsProps {
  readonly state: AppState;
  readonly send: (request: WebviewRequest) => void;
  readonly selectedNodeId: string | undefined;
  readonly onSelect: (node: ImpactGraphNodeDto) => void;
  readonly proposal: ProposedSelection | undefined;
  readonly onSelectProposal: (selection: ProposedSelection) => void;
  readonly onClearProposal: () => void;
}

/**
 * §18.5 has one evidence column, and it explains whatever is selected. A proposal is explained
 * entirely from the graph DTO (rationale, signals, origin option) — the host is not asked,
 * because the host has nothing to add about structure that does not exist yet.
 */
const Evidence = ({
  state,
  send,
  proposal,
  onClearProposal,
}: Pick<ColumnsProps, 'state' | 'send' | 'proposal' | 'onClearProposal'>): JSX.Element =>
  proposal === undefined ? (
    <EvidencePanel state={state.evidence} send={send} />
  ) : (
    <ProposedEvidencePanel
      selection={proposal}
      structure={state.graph.proposedStructure}
      onClear={onClearProposal}
    />
  );

const Columns = (props: ColumnsProps): JSX.Element => (
  <div className="columns">
    <SpecificationPanel state={props.state.specification} send={props.send} />
    <GraphPanel
      graph={props.state.graph}
      send={props.send}
      selectedNodeId={props.selectedNodeId}
      onSelect={props.onSelect}
      onSelectProposal={props.onSelectProposal}
      reducedMotion={prefersReducedMotion()}
    />
    <Evidence
      state={props.state}
      send={props.send}
      proposal={props.proposal}
      onClearProposal={props.onClearProposal}
    />
  </div>
);

export const App = (): JSX.Element => {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [proposal, setProposal] = useState<ProposedSelection | undefined>(undefined);
  const send = useHostChannel(dispatch);

  const selectProposal = useCallback((selection: ProposedSelection): void => {
    setProposal(selection);
    setSelectedNodeId(selection.record.id);
  }, []);

  const selectNode = useCallback(
    (node: ImpactGraphNodeDto): void => {
      setProposal(undefined);
      setSelectedNodeId(node.id);
      const requirementId = node.requirementIds[0];
      send({
        type: 'webview/select-node',
        payload: {
          nodeId: node.id,
          ...(requirementId === undefined ? {} : { requirementId }),
        },
      });
    },
    [send],
  );

  return (
    <main className="app">
      <ErrorBanner
        errors={state.errors}
        onDismiss={() => {
          dispatch({ kind: 'dismiss-errors' });
        }}
      />
      {state.busy ? (
        <p className="busy" role="status">
          {state.busyLabel ?? 'Working…'}
        </p>
      ) : null}
      <Columns
        state={state}
        send={send}
        selectedNodeId={selectedNodeId}
        onSelect={selectNode}
        proposal={proposal}
        onSelectProposal={selectProposal}
        onClearProposal={() => {
          setProposal(undefined);
        }}
      />
    </main>
  );
};
