import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS } from '../graph/filters.js';

import { EvidencePanel } from './evidence-panel.js';
import { GraphControls } from './graph-controls.js';
import { NodeList } from './node-list.js';

import type { EvidencePanelStateDto, ImpactGraphNodeDto } from '@impactgraph/contracts';
import type { JSX } from 'react';
import type { Root } from 'react-dom/client';

// ADR-0015, dogfooding item 4 — the evidence basis and the tier cap are VISIBLE wherever
// likelihood is shown, as text (§37, never colour-only), and stay apart from the §3 knowledge
// badges: the basis is an attribute WITHIN deterministic knowledge, never a fourth category.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const evidenceState: EvidencePanelStateDto = {
  schemaVersion: 1,
  status: 'loaded',
  target: { nodeId: 'node-1', name: 'DealVisibilityPolicy' },
  impact: {
    analysisId: 'an-1',
    requirementId: 'req-1',
    requirementStatement: 'Owners see their own deals',
    expectedChange: 'logic-change',
    likelihood: 'required',
    directness: 'direct',
    confidence: 0.88,
    provenance: 'static-analysis',
    dependencyPath: [],
    evidenceFiles: [],
    relatedTests: [],
    evidenceTypes: ['direct-structural'],
  },
  humanDecisions: [],
  warnings: [],
};

const impactOf = (state: EvidencePanelStateDto): NonNullable<EvidencePanelStateDto['impact']> => {
  if (state.impact === undefined) {
    throw new Error('fixture must carry an impact');
  }
  return state.impact;
};

describe('evidence panel basis rendering (§18.5, ADR-0015)', () => {
  it('shows the evidence basis where likelihood is shown, and its absence explicitly', () => {
    render(<EvidencePanel state={evidenceState} send={() => undefined} />);
    expect(container.querySelector('.evidence-basis')?.textContent).toContain('direct-structural');
    render(
      <EvidencePanel
        state={{
          ...evidenceState,
          impact: { ...impactOf(evidenceState), evidenceTypes: undefined },
        }}
        send={() => undefined}
      />,
    );
    expect(container.querySelector('.evidence-basis')?.textContent).toContain(
      'not reported by the analysis',
    );
  });

  it('renders the tier cap as TEXT when the likelihood was reduced (§37)', () => {
    render(
      <EvidencePanel
        state={{
          ...evidenceState,
          impact: {
            ...impactOf(evidenceState),
            likelihood: 'likely',
            evidenceTypes: ['name-similarity'],
            tierCappedBy: 'name-similarity',
          },
        }}
        send={() => undefined}
      />,
    );
    const marker = container.querySelector('[data-tier-capped-by]');
    expect(marker?.textContent).toContain('TIER CAPPED');
    expect(marker?.textContent).toContain('name-similarity');
    // uncapped impacts show no marker — the cap is a statement, never a default
    render(<EvidencePanel state={evidenceState} send={() => undefined} />);
    expect(container.querySelector('[data-tier-capped-by]')).toBeNull();
  });
});

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

const renderList = (listNodes: readonly ImpactGraphNodeDto[]): void => {
  render(
    <NodeList
      nodes={listNodes}
      analysisId="an-1"
      selectedNodeId={undefined}
      onSelect={() => undefined}
      send={() => undefined}
    />,
  );
};

describe('node list basis indicator (§37 tree parity, ADR-0015)', () => {
  it('shows a compact per-impact basis indicator and a TEXT tier-cap marker', () => {
    renderList(nodes);
    const bases = [...container.querySelectorAll('.node-row__basis')];
    expect(bases[0]?.textContent).toContain('direct-structural');
    expect(bases[1]?.textContent).toContain('name-similarity');
    // the full set is announced, not just the primary
    expect(bases[1]?.getAttribute('aria-label')).toContain('lexical-only');
    const marker = container.querySelector(
      '[data-node-id="n2"] [data-tier-capped-by="name-similarity"]',
    );
    expect(marker?.textContent).toContain('TIER CAPPED');
    expect(container.querySelector('[data-node-id="n1"] [data-tier-capped-by]')).toBeNull();
    // the basis is metadata WITHIN deterministic knowledge — the §3 badges stay untouched
    const badges = [...container.querySelectorAll('.badge')].map((badge) => badge.textContent);
    expect(badges).toContain('FACT');
    expect(badges).toContain('INFERRED');
  });

  it('says so when an impact reports no basis, instead of inventing one', () => {
    renderList([{ ...(nodes[0] as ImpactGraphNodeDto), evidenceTypes: undefined }]);
    expect(container.querySelector('.node-row__basis')?.textContent).toContain('not reported');
  });
});

describe('graph controls evidence-basis facet (§18.4, ADR-0015)', () => {
  it('offers a labelled checkbox per basis present and requests the filter change', () => {
    const changes: unknown[] = [];
    render(
      <GraphControls
        filters={DEFAULT_FILTERS}
        impactTypes={['logic-change']}
        evidenceTypes={['direct-structural', 'name-similarity']}
        onChange={(next) => changes.push(next)}
      />,
    );
    const legend = [...container.querySelectorAll('legend')].find(
      (element) => element.textContent === 'Evidence basis',
    );
    expect(legend).toBeDefined();
    const checkbox = container.querySelector('#evidence-basis-name-similarity');
    expect(checkbox).not.toBeNull();
    click(checkbox);
    expect(changes[0]).toMatchObject({ evidenceTypes: ['name-similarity'] });
  });

  it('renders no basis facet when the analysis reported no bases — never an empty control', () => {
    render(
      <GraphControls
        filters={DEFAULT_FILTERS}
        impactTypes={[]}
        evidenceTypes={[]}
        onChange={() => undefined}
      />,
    );
    const legends = [...container.querySelectorAll('legend')].map((el) => el.textContent);
    expect(legends).not.toContain('Evidence basis');
  });
});
