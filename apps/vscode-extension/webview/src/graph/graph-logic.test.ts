import { describe, expect, it } from 'vitest';

import { presentationForCategory } from '../provenance.js';

import { MAX_VISIBLE_NODES, disclosureSummary, planDisclosure } from './disclosure.js';
import { buildElements } from './elements.js';
import {
  DEFAULT_FILTERS,
  applyEdgeFilters,
  applyNodeFilters,
  evidenceBasesPresent,
  groupFor,
} from './filters.js';

import type { ImpactGraphDto, ImpactGraphNodeDto } from '@impactgraph/contracts';

const node = (overrides: Partial<ImpactGraphNodeDto> & { id: string }): ImpactGraphNodeDto => ({
  name: overrides.id,
  kind: 'impact',
  requirementIds: ['req-1'],
  likelihood: 'likely',
  impactType: 'logic-change',
  directness: 'direct',
  confidence: 0.7,
  provenance: 'static-analysis',
  knowledgeCategory: 'deterministic',
  ...overrides,
});

const manyNodes = (count: number): ImpactGraphNodeDto[] =>
  Array.from({ length: count }, (_unused, index) =>
    node({
      id: `node-${String(index)}`,
      requirementIds: [`req-${String(index % 4)}`],
      context: `context-${String(index % 4)}`,
      confidence: (index % 10) / 10,
    }),
  );

const labels = new Map([
  ['req-0', 'Requirement zero'],
  ['req-1', 'Requirement one'],
]);

describe('filters (PRD §18.4)', () => {
  const nodes = [
    node({ id: 'a', impactType: 'logic-change', confidence: 0.9, likelihood: 'required' }),
    node({
      id: 'b',
      impactType: 'contract-change',
      confidence: 0.3,
      directness: 'indirect',
      provenance: 'llm-inferred',
      knowledgeCategory: 'ai-inferred',
    }),
    node({ id: 'hop:c', kind: 'dependency', name: 'c', likelihood: undefined }),
  ];

  it('filters by impact type, confidence, likelihood and directness', () => {
    expect(
      applyNodeFilters(nodes, { ...DEFAULT_FILTERS, impactTypes: ['logic-change'] }).map(
        (n) => n.id,
      ),
    ).toEqual(['a', 'hop:c']);
    expect(
      applyNodeFilters(nodes, { ...DEFAULT_FILTERS, minConfidence: 0.5 }).map((n) => n.id),
    ).toEqual(['a', 'hop:c']);
    expect(
      applyNodeFilters(nodes, { ...DEFAULT_FILTERS, directness: 'indirect' }).map((n) => n.id),
    ).toEqual(['b', 'hop:c']);
  });

  it('inferred-only keeps AI-inferred impacts and never restyles them as deterministic', () => {
    const inferred = applyNodeFilters(nodes, { ...DEFAULT_FILTERS, inferredOnly: true });
    expect(inferred.map((n) => n.id)).toEqual(['b', 'hop:c']);
    expect(presentationForCategory(inferred[0]?.knowledgeCategory).badge).toBe('INFERRED');
  });

  it('hide-unchanged drops dependency-path hops', () => {
    expect(
      applyNodeFilters(nodes, { ...DEFAULT_FILTERS, hideUnchanged: true }).map((n) => n.id),
    ).toEqual(['a', 'b']);
  });

  it('drops edges whose endpoints are not visible', () => {
    const edges = [
      {
        id: 'e1',
        sourceId: 'a',
        targetId: 'b',
        label: 'depends on',
        directness: 'direct' as const,
      },
      {
        id: 'e2',
        sourceId: 'a',
        targetId: 'zz',
        label: 'depends on',
        directness: 'direct' as const,
      },
    ];
    expect(applyEdgeFilters(edges, new Set(['a', 'b'])).map((edge) => edge.id)).toEqual(['e1']);
  });

  it('defaults the evidence-basis facet to all — nothing is hidden until the user narrows', () => {
    expect(DEFAULT_FILTERS.evidenceTypes).toEqual([]);
    expect(applyNodeFilters(nodes, DEFAULT_FILTERS).map((n) => n.id)).toEqual(['a', 'b', 'hop:c']);
  });

  it('filters by evidence basis: any overlap keeps the node, no basis fails the selection', () => {
    const based = [
      node({ id: 'strong', evidenceTypes: ['direct-structural'] }),
      node({ id: 'fuzzy', evidenceTypes: ['name-similarity', 'lexical-only'] }),
      node({ id: 'unreported' }),
      node({ id: 'hop:d', kind: 'dependency', name: 'd', likelihood: undefined }),
    ];
    const filtered = applyNodeFilters(based, {
      ...DEFAULT_FILTERS,
      evidenceTypes: ['direct-structural', 'async-event'],
    });
    // dependency hops carry no basis and stay — the facet speaks only about impacts
    expect(filtered.map((n) => n.id)).toEqual(['strong', 'hop:d']);
    expect(
      applyNodeFilters(based, { ...DEFAULT_FILTERS, evidenceTypes: ['lexical-only'] }).map(
        (n) => n.id,
      ),
    ).toEqual(['fuzzy', 'hop:d']);
  });

  it('lists the bases present in the data, in the contract vocabulary order', () => {
    const based = [
      node({ id: 'x', evidenceTypes: ['lexical-only', 'name-similarity'] }),
      node({ id: 'y', evidenceTypes: ['direct-structural'] }),
      node({ id: 'z' }),
    ];
    expect(evidenceBasesPresent(based)).toEqual([
      'direct-structural',
      'name-similarity',
      'lexical-only',
    ]);
    expect(evidenceBasesPresent([node({ id: 'z' })])).toEqual([]);
  });

  it('defaults to the §18.4 context → component level', () => {
    expect(DEFAULT_FILTERS.groupBy).toBe('context');
  });

  it('groups by the chosen dimension', () => {
    expect(groupFor(nodes[0] as ImpactGraphNodeDto, 'requirement', labels).label).toBe(
      'Requirement one',
    );
    expect(groupFor(nodes[0] as ImpactGraphNodeDto, 'impact-type', labels).label).toBe(
      'logic-change',
    );
  });

  it('groups by owning application, and says so when a component has none (§18.4)', () => {
    const owned = node({ id: 'a', application: '@fixture/api' });
    expect(groupFor(owned, 'application', labels)).toEqual({
      id: 'group:application:@fixture/api',
      label: '@fixture/api',
    });
    expect(groupFor(node({ id: 'b' }), 'application', labels).label).toBe('no application');
  });

  it('groups by §Z5 effective context, and says so when a component has none (§18.4)', () => {
    const assigned = node({ id: 'a', context: 'deal-management' });
    expect(groupFor(assigned, 'context', labels)).toEqual({
      id: 'group:context:deal-management',
      label: 'deal-management',
    });
    // an unassigned component is labeled as such — never guessed into a context from its path
    const unassigned = node({ id: 'b' });
    expect(groupFor(unassigned, 'context', labels).label).toBe('no context assigned');
  });
});

describe('progressive disclosure (PRD §33, §43.1)', () => {
  it('shows everything when the analysis is under the node budget', () => {
    const nodes = manyNodes(50);
    const plan = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    expect(plan.visibleNodes).toHaveLength(50);
    expect(plan.budgetExceeded).toBe(false);
    expect(plan.hiddenCount).toBe(0);
  });

  it('collapses to group level past the budget and never exceeds the cap', () => {
    const nodes = manyNodes(412);
    const plan = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    expect(plan.budgetExceeded).toBe(true);
    expect(plan.visibleNodes).toHaveLength(0);
    expect(plan.hiddenCount).toBe(412);
    expect(plan.collapsedGroups.reduce((sum, group) => sum + group.hiddenCount, 0)).toBe(412);
  });

  it('expanding one context reveals it, still capped at the budget', () => {
    const nodes = manyNodes(900);
    const plan = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(['group:context:context-1']),
    });
    expect(plan.visibleNodes.length).toBeLessThanOrEqual(MAX_VISIBLE_NODES);
    expect(plan.visibleNodes.length).toBeGreaterThan(0);
    expect(plan.hiddenCount).toBeGreaterThan(0);
  });

  it('holds the budget on the new default even when every node lacks a context', () => {
    // The pessimal shape for context grouping: one giant "no context assigned" bucket.
    const nodes = manyNodes(900).map((entry) => ({ ...entry, context: undefined }));
    const plan = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    expect(plan.groups.map((group) => group.label)).toEqual(['no context assigned']);
    expect(plan.visibleNodes).toHaveLength(0);
    expect(plan.budgetExceeded).toBe(true);
    // …and expanding that single bucket still cannot exceed the cap.
    const expanded = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(['group:context:no context assigned']),
    });
    expect(expanded.visibleNodes).toHaveLength(MAX_VISIBLE_NODES);
    expect(expanded.hiddenCount).toBe(900 - MAX_VISIBLE_NODES);
  });

  it('states the counts out loud — truncation is never silent', () => {
    const nodes = manyNodes(412);
    const plan = planDisclosure({
      nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    const summary = disclosureSummary(plan, 500);
    expect(summary).toContain('Showing 0 of 412');
    expect(summary).toContain('500 in the analysis');
    expect(summary).toContain('412 hidden');
  });
});

describe('cytoscape elements keep the three knowledge categories distinct (PRD §3, §37)', () => {
  const graph: ImpactGraphDto = {
    schemaVersion: 1,
    status: 'loaded',
    analysisId: 'an-1',
    requirements: [{ id: 'req-1', statement: 'Requirement one' }],
    nodes: [
      node({ id: 'fact', provenance: 'static-analysis', knowledgeCategory: 'deterministic' }),
      node({ id: 'guess', provenance: 'llm-inferred', knowledgeCategory: 'ai-inferred' }),
      node({ id: 'human', provenance: 'human-confirmed', knowledgeCategory: 'human-confirmed' }),
      node({ id: 'mystery', provenance: undefined, knowledgeCategory: undefined }),
    ],
    edges: [],
    totalNodeCount: 4,
    warnings: [],
  };

  const elements = (): ReturnType<typeof buildElements> => {
    const plan = planDisclosure({
      nodes: graph.nodes,
      filters: DEFAULT_FILTERS,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    return buildElements({ graph, plan, filters: DEFAULT_FILTERS, requirementLabels: labels });
  };

  it('gives every category a unique shape, border style and TEXT badge', () => {
    const nodes = elements().filter((element) => element.classes?.includes('impact-node') ?? false);
    const byId = new Map(nodes.map((element) => [String(element.data.id), element.data]));
    expect(String(byId.get('fact')?.label)).toContain('[FACT]');
    expect(String(byId.get('guess')?.label)).toContain('[INFERRED]');
    expect(String(byId.get('human')?.label)).toContain('[CONFIRMED]');
    const shapes = nodes.map((element) => String(element.data.shape));
    const borders = nodes.map((element) => String(element.data.borderStyle));
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(3);
    expect(new Set(borders).size).toBeGreaterThanOrEqual(3);
  });

  it('never promotes unknown provenance to a fact', () => {
    const mystery = elements().find((element) => element.data.id === 'mystery');
    expect(String(mystery?.data.label)).toContain('[UNCLASSIFIED]');
    expect(mystery?.data.knowledge).toBe('unclassified');
  });

  it('exposes a screen-reader label carrying likelihood, directness and confidence', () => {
    const fact = elements().find((element) => element.data.id === 'fact');
    expect(String(fact?.data.ariaLabel)).toContain('likely');
    expect(String(fact?.data.ariaLabel)).toContain('direct');
    expect(String(fact?.data.ariaLabel)).toContain('confidence: 0.70');
  });

  it('creates one compound parent per used group — contexts, at the default level', () => {
    // None of these fixture nodes carries a context, so the single compound parent is the
    // explicit unassigned bucket rather than a context guessed from anything (§18.4, §Z5).
    const groups = elements().filter((element) => element.classes === 'group');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.data.label).toBe('no context assigned');
  });
});
