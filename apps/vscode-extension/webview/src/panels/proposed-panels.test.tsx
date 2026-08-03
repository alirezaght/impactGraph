import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProposedEvidencePanel } from './proposed-evidence.js';
import { ProposedList } from './proposed-list.js';

import type { ProposedSelection } from '../graph/proposed.js';
import type {
  ProposedGraphRelationshipDto,
  ProposedStructureViewDto,
} from '@impactgraph/contracts';
import type { JSX } from 'react';
import type { Root } from 'react-dom/client';

// §18.5 for the proposed half, and §37 tree parity for it. Two things are asserted everywhere
// here: a proposal reads as a proposal in TEXT, and it reads as AI-assisted rather than as fact.

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

const relationship: ProposedGraphRelationshipDto = {
  id: 'rel-1',
  sourceId: 'DealVisibilityPolicy',
  targetId: 'DealProjection',
  sourceKind: 'existing',
  targetKind: 'proposed',
  type: 'data-dependency',
  status: 'proposed',
  originOptionId: 'opt-read-model',
  originOptionTitle: 'Introduce a deal read model',
  rationale: 'the option reads visibility from a projection instead of the write model',
  provenance: 'llm-inferred',
  knowledgeCategory: 'ai-inferred',
  evidenceIds: ['ev-7'],
  confidence: 0.62,
  confidenceSignals: [
    { type: 'exact match DealVisibilityPolicy', contribution: 0.3 },
    { type: 'one indirect event boundary', contribution: -0.12, description: 'crosses a queue' },
  ],
};

const structure: ProposedStructureViewDto = {
  nodes: [
    {
      id: 'DealProjection',
      name: 'DealProjection',
      category: 'component',
      type: 'service',
      originOptionId: 'opt-read-model',
      originOptionTitle: 'Introduce a deal read model',
      rationale: 'the option needs somewhere to project into',
      provenance: 'llm-inferred',
      knowledgeCategory: 'ai-inferred',
      evidenceIds: [],
      confidence: 0.55,
      confidenceSignals: [{ type: 'option-footprint', contribution: 0.15 }],
    },
  ],
  relationships: [relationship],
};

describe('the proposed list is the keyboard/screen-reader path (§37)', () => {
  it('lists every proposal as a focusable button whose text says PROPOSED', () => {
    render(
      <ProposedList
        structure={structure}
        view="both"
        selectedId={undefined}
        onSelect={() => undefined}
      />,
    );
    const rows = [...container.querySelectorAll('.proposed-row')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.textContent).toContain('[PROPOSED]');
      expect(row.getAttribute('data-state')).toBe('proposed');
      expect(row.querySelector('button')).not.toBeNull();
    }
    expect(container.querySelector('.proposed-list')?.getAttribute('aria-label')).toContain(
      'keyboard equivalent',
    );
  });

  it('gives every row a screen-reader sentence that leads with "Proposed"', () => {
    render(
      <ProposedList
        structure={structure}
        view="both"
        selectedId={undefined}
        onSelect={() => undefined}
      />,
    );
    for (const button of container.querySelectorAll('.proposed-row__select')) {
      expect(button.getAttribute('aria-label')).toMatch(/^Proposed (relationship|component)/);
    }
  });

  it('reports absence explicitly instead of rendering nothing', () => {
    render(
      <ProposedList
        structure={{ nodes: [], relationships: [] }}
        view="both"
        selectedId={undefined}
        onSelect={() => undefined}
      />,
    );
    expect(container.textContent).toContain('No proposed structure');
  });

  it('disappears entirely under the current-only view', () => {
    render(
      <ProposedList
        structure={structure}
        view="current-only"
        selectedId={undefined}
        onSelect={() => undefined}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('selects the record itself, so the panel never re-derives it', () => {
    const selected: ProposedSelection[] = [];
    render(
      <ProposedList
        structure={structure}
        view="both"
        selectedId={undefined}
        onSelect={(selection) => selected.push(selection)}
      />,
    );
    click(container.querySelector('.proposed-row__select'));
    expect(selected[0]?.kind).toBe('relationship');
    expect(selected[0]?.record).toBe(relationship);
  });
});

describe('the proposed evidence panel (§18.5, §43.6)', () => {
  const renderPanel = (
    selection: ProposedSelection = { kind: 'relationship', record: relationship },
  ) => {
    render(
      <ProposedEvidencePanel
        selection={selection}
        structure={structure}
        onClear={() => undefined}
      />,
    );
  };

  it('reads as AI-assisted and unbuilt, never as a fact', () => {
    renderPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('not a fact');
    expect(text).toContain('AI-assisted');
    expect(text).toContain('not present in the repository');
    // the knowledge badge is text, not colour, and says INFERRED
    expect(container.querySelector('[data-knowledge-category]')?.textContent).toBe('INFERRED');
    expect(container.querySelector('.badge--proposed')?.textContent).toBe('PROPOSED');
  });

  it('shows the rationale, the confidence and its §14 signal breakdown', () => {
    renderPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('reads visibility from a projection');
    expect(text).toContain('confidence: 0.62');
    const signals = [...container.querySelectorAll('.signal')].map((node) => node.textContent);
    expect(signals[0]).toContain('exact match DealVisibilityPolicy');
    expect(signals[0]).toContain('+0.30');
    expect(signals[1]).toContain('one indirect event boundary');
    expect(signals[1]).toContain('-0.12');
    expect(signals[1]).toContain('crosses a queue');
  });

  it('links the proposal to the option that proposed it, and to that option’s siblings', () => {
    renderPanel();
    const origin = container.querySelector('.proposed-origin');
    expect(origin?.textContent).toContain('Introduce a deal read model');
    expect(origin?.querySelector('[data-option-id]')?.getAttribute('data-option-id')).toBe(
      'opt-read-model',
    );
    expect(origin?.textContent).toContain('DealProjection');
  });

  it('names both endpoints with the kind each resolves against', () => {
    renderPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('DealVisibilityPolicy (existing component)');
    expect(text).toContain('DealProjection (proposed component)');
  });

  it('explains a proposed component too, not only a relationship', () => {
    const component = structure.nodes[0];
    expect(component).toBeDefined();
    renderPanel({ kind: 'component', record: component as never });
    const text = container.textContent ?? '';
    expect(text).toContain('Proposed component');
    expect(text).toContain('would be created; it does not exist yet');
    expect(text).toContain('component / service');
  });

  it('renders missing evidence as explicitly absent rather than reassuring', () => {
    const component = structure.nodes[0];
    renderPanel({ kind: 'component', record: component as never });
    expect(container.querySelector('.absent')?.textContent).toContain('not reported');
  });
});
