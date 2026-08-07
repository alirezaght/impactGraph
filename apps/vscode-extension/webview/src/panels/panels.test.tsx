import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EvidencePanel } from './evidence-panel.js';
import { NodeList } from './node-list.js';
import { SpecificationPanel } from './specification-panel.js';

import type { WebviewRequest } from '../messaging.js';
import type {
  EvidencePanelStateDto,
  ImpactGraphNodeDto,
  SpecificationPanelStateDto,
} from '@impactgraph/contracts';
import type { JSX } from 'react';
import type { Root } from 'react-dom/client';

// jsdom component tests: rendering, provenance distinction without colour, and the fact that
// every action leaves as a typed request rather than being applied locally.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Drive a controlled React input: React listens to the native value setter, not to assignment. */
const typeInto = (field: HTMLTextAreaElement, value: string): void => {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter is called explicitly below
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const render = (element: JSX.Element): void => {
  act(() => {
    root.render(element);
  });
};

const click = (element: Element | null): void => {
  act(() => {
    (element as HTMLElement | null)?.click();
  });
};

const specificationState: SpecificationPanelStateDto = {
  schemaVersion: 1,
  status: 'loaded',
  specification: { id: 'spec-a', version: 2, title: 'Deal visibility', rawText: '# Deal' },
  requirements: [
    {
      id: 'req-1',
      statement: 'Owners see their own deals',
      type: 'functional',
      status: 'extracted',
      concepts: ['deal'],
      actors: ['owner'],
    },
  ],
  openQuestions: [
    {
      id: 'q-1',
      question: 'Do archived deals stay visible?',
      reason: 'two candidate policies',
      severity: 'blocking',
      status: 'open',
      affectedRequirementIds: ['req-1'],
    },
  ],
  readiness: {
    score: 70,
    blockingQuestions: 1,
    importantQuestions: 0,
    minorQuestions: 0,
    recommendedAction: 'Answer the blocking question before implementing.',
  },
  availableVersions: [1, 2],
  warnings: [],
};

describe('specification panel (§18.2)', () => {
  it('shows requirements, open questions with severity, and readiness', () => {
    render(<SpecificationPanel state={specificationState} send={() => undefined} />);
    expect(container.textContent).toContain('Owners see their own deals');
    expect(container.textContent).toContain('Do archived deals stay visible?');
    expect(container.querySelector('[data-severity="blocking"]')).not.toBeNull();
    expect(container.textContent).toContain('Implementation readiness: 70/100');
  });

  it('sends a typed answer request instead of answering locally', () => {
    const sent: WebviewRequest[] = [];
    render(
      <SpecificationPanel state={specificationState} send={(request) => sent.push(request)} />,
    );
    const textarea = container.querySelector('#answer-q-1') as HTMLTextAreaElement;
    act(() => {
      typeInto(textarea, 'Yes, archived deals stay visible to owners.');
    });
    const buttons = [...container.querySelectorAll('button')];
    click(buttons.find((button) => button.textContent === 'Record answer') ?? null);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('webview/answer-question');
    // The panel does NOT mark the question answered — the host's next state message does.
    expect(container.textContent).not.toContain('Answered:');
  });

  it('offers the empty state when nothing has been entered', () => {
    render(
      <SpecificationPanel
        state={{ ...specificationState, status: 'empty', specification: undefined }}
        send={() => undefined}
      />,
    );
    expect(container.querySelector('.empty-state')?.textContent).toContain('Paste a specification');
  });
});

const evidenceState: EvidencePanelStateDto = {
  schemaVersion: 1,
  status: 'loaded',
  target: { nodeId: 'node-1', name: 'DealVisibilityPolicy', path: 'src/deal/policy.ts' },
  impact: {
    analysisId: 'an-1',
    requirementId: 'req-1',
    requirementStatement: 'Owners see their own deals',
    expectedChange: 'logic-change',
    likelihood: 'required',
    directness: 'direct',
    confidence: 0.88,
    provenance: 'static-analysis',
    dependencyPath: ['DealController', 'DealService'],
    evidenceFiles: ['src/deal/policy.ts', 'src/deal/policy.test.ts'],
    relatedTests: ['src/deal/policy.test.ts'],
    evidenceTypes: ['direct-structural'],
  },
  explanation: {
    nodeId: 'node-1',
    name: 'DealVisibilityPolicy',
    category: 'application',
    type: 'class',
    path: 'src/deal/policy.ts',
    knowledge: {
      provenance: 'static-analysis',
      knowledgeCategory: 'deterministic',
      confidence: 0.88,
      confidenceSignals: [
        { type: 'exact-name-match', contribution: 0.6 },
        { type: 'indirect-event-boundary', contribution: -0.12 },
      ],
      evidence: [
        {
          id: 'ev-1',
          source: 'src/deal/policy.ts',
          range: { startLine: 12, startColumn: 1, endLine: 40, endColumn: 1 },
        },
      ],
      repositorySnapshotId: 'snap-1',
      analysisRunId: 'run-1',
    },
    incomingEdges: [],
    outgoingEdges: [],
  },
  humanDecisions: [],
  warnings: [],
};

describe('evidence panel (§18.5, §14)', () => {
  it('renders the confidence signal breakdown with signed contributions', () => {
    render(<EvidencePanel state={evidenceState} send={() => undefined} />);
    expect(container.textContent).toContain('exact-name-match (+0.60)');
    expect(container.textContent).toContain('indirect-event-boundary (-0.12)');
    expect(container.textContent).toContain('confidence: 0.88 (high)');
  });

  it('renders requirement, expected change, directness, dependency path and related tests', () => {
    render(<EvidencePanel state={evidenceState} send={() => undefined} />);
    expect(container.textContent).toContain('Owners see their own deals');
    expect(container.textContent).toContain('logic-change');
    expect(container.querySelector('[data-directness="direct"]')).not.toBeNull();
    expect(container.textContent).toContain('DealController → DealService');
    expect(container.textContent).toContain('src/deal/policy.test.ts');
  });

  it('opens an evidence record at its range through a typed request', () => {
    const sent: WebviewRequest[] = [];
    render(<EvidencePanel state={evidenceState} send={(request) => sent.push(request)} />);
    const record = [...container.querySelectorAll('.evidence-records button')][0] ?? null;
    click(record);
    expect(sent[0]).toEqual({
      type: 'webview/open-source',
      payload: {
        path: 'src/deal/policy.ts',
        range: { startLine: 12, startColumn: 1, endLine: 40, endColumn: 1 },
      },
    });
  });

  it('marks missing sections as absent rather than inventing reassuring values', () => {
    render(
      <EvidencePanel
        state={{ ...evidenceState, explanation: undefined, impact: undefined }}
        send={() => undefined}
      />,
    );
    const absent = [...container.querySelectorAll('.absent')].map((node) => node.textContent);
    expect(absent.join(' ')).toContain('Confidence signals');
    expect(absent.join(' ')).toContain('Impact classification');
    expect(container.textContent).not.toContain('confidence: 1.00');
  });

  it('renders a non-loaded status verbatim', () => {
    render(
      <EvidencePanel
        state={{
          schemaVersion: 1,
          status: 'unavailable',
          message: 'no index generation',
          humanDecisions: [],
          warnings: [],
        }}
        send={() => undefined}
      />,
    );
    expect(container.querySelector('[data-status="unavailable"]')?.textContent).toBe(
      'no index generation',
    );
  });
});

describe('node list (§37 tree parity, §3 provenance)', () => {
  const nodes: ImpactGraphNodeDto[] = [
    {
      id: 'n1',
      name: 'DealService',
      kind: 'impact',
      requirementIds: ['req-1'],
      likelihood: 'required',
      impactType: 'logic-change',
      directness: 'direct',
      confidence: 0.9,
      provenance: 'static-analysis',
      knowledgeCategory: 'deterministic',
      filePath: 'src/deal/service.ts',
      evidenceTypes: ['direct-structural'],
    },
    {
      id: 'n2',
      name: 'SearchIndexer',
      kind: 'impact',
      requirementIds: ['req-1'],
      likelihood: 'possible',
      impactType: 'behaviour-change',
      directness: 'indirect',
      confidence: 0.4,
      provenance: 'llm-inferred',
      knowledgeCategory: 'ai-inferred',
      evidenceTypes: ['name-similarity', 'lexical-only'],
      tierCappedBy: 'name-similarity',
    },
  ];

  it('renders every node as a focusable row with a TEXT knowledge badge', () => {
    render(
      <NodeList
        nodes={nodes}
        analysisId="an-1"
        selectedNodeId={undefined}
        onSelect={() => undefined}
        send={() => undefined}
      />,
    );
    const badges = [...container.querySelectorAll('.badge')].map((node) => node.textContent);
    expect(badges).toEqual(['FACT', 'INFERRED']);
    expect(container.querySelectorAll('.node-row')).toHaveLength(2);
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
  });

  it('distinguishes the categories by border style as well as text', () => {
    render(
      <NodeList
        nodes={nodes}
        analysisId="an-1"
        selectedNodeId={undefined}
        onSelect={() => undefined}
        send={() => undefined}
      />,
    );
    const styles = [...container.querySelectorAll('.badge')].map((node) =>
      node.getAttribute('data-border-style'),
    );
    expect(new Set(styles).size).toBe(2);
  });

  it('sends accept/reject as typed requests and does not change the row itself', () => {
    const sent: WebviewRequest[] = [];
    render(
      <NodeList
        nodes={nodes}
        analysisId="an-1"
        selectedNodeId={undefined}
        onSelect={() => undefined}
        send={(request) => sent.push(request)}
      />,
    );
    const accept = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Accept',
    );
    click(accept ?? null);
    expect(sent[0]).toEqual({
      type: 'webview/impact-decision',
      payload: {
        analysisId: 'an-1',
        requirementId: 'req-1',
        nodeId: 'n1',
        decision: 'accepted',
      },
    });
    expect(container.querySelector('[data-node-id="n1"]')?.getAttribute('aria-current')).toBeNull();
  });
});
