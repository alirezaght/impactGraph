import type {
  EvidencePanelStateDto,
  HostMessage,
  ImpactGraphDto,
  SpecificationPanelStateDto,
} from '@impactgraph/contracts';

// The webview's entire state. It is a projection of host messages plus local view preferences
// (filters, expanded groups, active tab) — never a second source of truth about the analysis.

export interface AppState {
  readonly specification: SpecificationPanelStateDto;
  readonly graph: ImpactGraphDto;
  readonly evidence: EvidencePanelStateDto;
  readonly busy: boolean;
  readonly busyLabel?: string | undefined;
  /** Problems the user must see: rejected messages, host errors (§43.6 — never swallowed). */
  readonly errors: readonly string[];
}

export const INITIAL_SPECIFICATION: SpecificationPanelStateDto = {
  schemaVersion: 1,
  status: 'empty',
  requirements: [],
  openQuestions: [],
  availableVersions: [],
  warnings: [],
};

export const INITIAL_GRAPH: ImpactGraphDto = {
  schemaVersion: 1,
  status: 'empty',
  requirements: [],
  nodes: [],
  edges: [],
  totalNodeCount: 0,
  warnings: [],
};

export const INITIAL_EVIDENCE: EvidencePanelStateDto = {
  schemaVersion: 1,
  status: 'empty',
  message: 'Select an impact in the graph to see its evidence.',
  humanDecisions: [],
  warnings: [],
};

export const INITIAL_STATE: AppState = {
  specification: INITIAL_SPECIFICATION,
  graph: INITIAL_GRAPH,
  evidence: INITIAL_EVIDENCE,
  busy: false,
  errors: [],
};

export type AppAction =
  | { readonly kind: 'host'; readonly message: HostMessage }
  | { readonly kind: 'local-error'; readonly message: string }
  | { readonly kind: 'dismiss-errors' };

const fromHost = (state: AppState, message: HostMessage): AppState => {
  switch (message.type) {
    case 'host/specification':
      return { ...state, specification: message.payload.state };
    case 'host/graph':
      return { ...state, graph: message.payload.graph };
    case 'host/evidence':
      return { ...state, evidence: message.payload.state };
    case 'host/status':
      return { ...state, busy: message.payload.busy, busyLabel: message.payload.label };
    case 'host/error':
      return {
        ...state,
        errors: [...state.errors, `${message.payload.code}: ${message.payload.message}`],
      };
  }
};

export const reduce = (state: AppState, action: AppAction): AppState => {
  switch (action.kind) {
    case 'host':
      return fromHost(state, action.message);
    case 'local-error':
      return { ...state, errors: [...state.errors, action.message] };
    case 'dismiss-errors':
      return { ...state, errors: [] };
  }
};
