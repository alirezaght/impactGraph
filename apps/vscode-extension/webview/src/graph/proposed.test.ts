import { describe, expect, it } from 'vitest';

import { MAX_VISIBLE_NODES, planDisclosure } from './disclosure.js';
import { buildElements } from './elements.js';
import { DEFAULT_FILTERS, applyNodeFilters, groupFor } from './filters.js';
import {
  PROPOSED_GROUP,
  currentNodes,
  findProposal,
  isProposedNode,
  proposedEdgeAria,
  structureNodes,
} from './proposed.js';

import type { GraphFilters } from './filters.js';
import type { StructureView } from './proposed.js';
import type {
  ImpactGraphDto,
  ImpactGraphNodeDto,
  ProposedGraphNodeDto,
  ProposedGraphRelationshipDto,
} from '@impactgraph/contracts';
import type { ElementDefinition } from 'cytoscape';

// §18.4 current-vs-proposed. The four things this must never get wrong: the proposed half is not
// merged into the current one, it is distinguishable without colour, it is announced as proposed
// to a screen reader, and it counts against the §33 node budget like everything else.

const envelope = {
  originOptionId: 'opt-read-model',
  originOptionTitle: 'Introduce a deal read model',
  rationale: 'the option reads visibility from a projection',
  provenance: 'llm-inferred',
  knowledgeCategory: 'ai-inferred',
  evidenceIds: ['ev-1'],
  confidence: 0.62,
  confidenceSignals: [{ type: 'option-footprint', contribution: 0.2 }],
};

const proposedNode = (id: string): ProposedGraphNodeDto => ({
  id,
  name: id,
  category: 'component',
  type: 'service',
  ...envelope,
});

const proposedEdge = (
  overrides: Partial<ProposedGraphRelationshipDto> = {},
): ProposedGraphRelationshipDto => ({
  id: 'rel-1',
  sourceId: 'current-a',
  targetId: 'prop-1',
  sourceKind: 'existing',
  targetKind: 'proposed',
  type: 'data-dependency',
  status: 'proposed',
  ...envelope,
  ...overrides,
});

const currentNode = (id: string): ImpactGraphNodeDto => ({
  id,
  name: id,
  kind: 'impact',
  requirementIds: ['req-1'],
  likelihood: 'likely',
  impactType: 'logic-change',
  directness: 'direct',
  confidence: 0.8,
  provenance: 'static-analysis',
  knowledgeCategory: 'deterministic',
  context: 'Deal Management',
});

const graphWith = (
  nodes: readonly ImpactGraphNodeDto[],
  proposals: readonly ProposedGraphNodeDto[],
  relationships: readonly ProposedGraphRelationshipDto[],
): ImpactGraphDto => ({
  schemaVersion: 1,
  status: 'loaded',
  analysisId: 'an-1',
  requirements: [{ id: 'req-1', statement: 'Owners see their own deals' }],
  nodes: [...nodes],
  edges: [],
  totalNodeCount: nodes.length + proposals.length,
  proposedStructure: { nodes: [...proposals], relationships: [...relationships] },
  warnings: [],
});

const labels = new Map([['req-1', 'Requirement one']]);

const elementsFor = (graph: ImpactGraphDto, view: StructureView): ElementDefinition[] => {
  const filters: GraphFilters = { ...DEFAULT_FILTERS, structure: view };
  const plan = planDisclosure({
    nodes: applyNodeFilters(structureNodes(graph, view), filters),
    filters,
    requirementLabels: labels,
    expandedGroupIds: new Set(),
  });
  return buildElements({ graph, plan, filters, requirementLabels: labels });
};

const graph = graphWith(
  [currentNode('current-a'), currentNode('current-b')],
  [proposedNode('prop-1')],
  [proposedEdge()],
);

describe('the current/proposed/both filter (§18.4)', () => {
  it('defaults to BOTH so the two halves can be diffed rather than merged', () => {
    expect(DEFAULT_FILTERS.structure).toBe('both');
    const nodes = structureNodes(graph, DEFAULT_FILTERS.structure);
    expect(nodes.map((node) => node.id)).toEqual(['current-a', 'current-b', 'prop-1']);
    expect(nodes.filter(isProposedNode)).toHaveLength(1);
  });

  it('current-only removes every proposed element, node and edge alike', () => {
    expect(structureNodes(graph, 'current-only').map((node) => node.id)).toEqual([
      'current-a',
      'current-b',
    ]);
    const ids = elementsFor(graph, 'current-only').map((element) => String(element.data.id));
    expect(ids).not.toContain('prop-1');
    expect(ids).not.toContain('rel-1');
  });

  it('proposed-only keeps the proposals and only the current components they attach to', () => {
    const nodes = structureNodes(graph, 'proposed-only');
    // `current-a` is an anchor of the proposed edge; `current-b` is not part of the delta.
    expect(nodes.map((node) => node.id)).toEqual(['current-a', 'prop-1']);
    const ids = elementsFor(graph, 'proposed-only').map((element) => String(element.data.id));
    expect(ids).toContain('rel-1');
    expect(ids).not.toContain('current-b');
  });

  it('never renders a proposed edge whose endpoint is not visible', () => {
    const orphaned = graphWith(
      [currentNode('current-a')],
      [],
      [proposedEdge({ targetId: 'prop-missing' })],
    );
    const ids = elementsFor(orphaned, 'both').map((element) => String(element.data.id));
    expect(ids).not.toContain('rel-1');
  });

  it('keeps proposals out of every current grouping dimension', () => {
    const proposal = structureNodes(graph, 'both').filter(isProposedNode)[0];
    expect(proposal).toBeDefined();
    for (const dimension of ['context', 'requirement', 'knowledge'] as const) {
      expect(groupFor(proposal as never, dimension, labels)).toEqual(PROPOSED_GROUP);
    }
    expect(currentNodes(structureNodes(graph, 'both')).map((node) => node.id)).toEqual([
      'current-a',
      'current-b',
    ]);
  });

  it('does not let the impact facets silently hide the proposed half', () => {
    const filters: GraphFilters = {
      ...DEFAULT_FILTERS,
      minConfidence: 0.95,
      impactTypes: ['contract-change'],
      likelihoods: ['required'],
    };
    const kept = applyNodeFilters(structureNodes(graph, 'both'), filters);
    expect(kept.map((node) => node.id)).toEqual(['prop-1']);
  });

  it('still honours search, so a proposal can be filtered out deliberately', () => {
    const filters: GraphFilters = { ...DEFAULT_FILTERS, search: 'current' };
    expect(applyNodeFilters(structureNodes(graph, 'both'), filters).map((node) => node.id)).toEqual(
      ['current-a', 'current-b'],
    );
  });
});

describe('the fourth line treatment, without colour (§3, §37)', () => {
  const elements = elementsFor(graph, 'both');
  const edge = elements.find((element) => element.data.id === 'rel-1');
  const node = elements.find((element) => element.data.id === 'prop-1');

  it('gives the proposed edge its own class, line style and text badge', () => {
    expect(edge?.classes).toContain('proposed-edge');
    // NOT the current-edge class: it cannot inherit a current line treatment by accident.
    expect(edge?.classes).not.toContain('impact-edge');
    expect(edge?.data.lineStyle).toBe('long-dash');
    expect(String(edge?.data.label)).toContain('[PROPOSED]');
    expect(edge?.data.state).toBe('proposed');
  });

  it('uses a line treatment none of the three current ones use', () => {
    const currentTreatments = new Set(
      elementsFor(graph, 'current-only')
        .filter((element) => element.classes?.includes('impact-edge') ?? false)
        .map((element) => String(element.data.lineStyle)),
    );
    expect(currentTreatments.has('long-dash')).toBe(false);
  });

  it('marks the proposed component in words while keeping its knowledge category visible', () => {
    expect(node?.classes).toContain('proposed-node');
    expect(String(node?.data.label)).toContain('[PROPOSED]');
    // §3: it is still AI-inferred knowledge, and that must not be erased by the proposed marker.
    expect(String(node?.data.label)).toContain('[INFERRED]');
    expect(node?.data.knowledge).toBe('ai-inferred');
    expect(node?.data.parent).toBe(PROPOSED_GROUP.id);
  });

  it('announces "proposed" to a screen reader before anything else', () => {
    expect(String(edge?.data.ariaLabel)).toMatch(/^Proposed relationship, not present/);
    expect(String(edge?.data.ariaLabel)).toContain('Introduce a deal read model');
    expect(String(edge?.data.ariaLabel)).toContain('confidence: 0.62');
    expect(String(node?.data.ariaLabel)).toMatch(/^Proposed component, would be created/);
    // a current node is never described as proposed
    const current = elements.find((element) => element.data.id === 'current-a');
    expect(String(current?.data.ariaLabel)).not.toContain('Proposed');
    expect(current?.data.state).toBe('current');
  });

  it('names the origin option when the graph carries no title either', () => {
    const untitled = proposedEdge({ originOptionTitle: undefined });
    expect(proposedEdgeAria(untitled)).toContain('opt-read-model');
  });

  it('gives the proposed compound parent a label that says so in words', () => {
    const parent = elements.find((element) => element.data.id === PROPOSED_GROUP.id);
    expect(String(parent?.data.label)).toContain('Proposed structure');
  });
});

describe('the node budget still holds with proposed elements (§33, §43.1)', () => {
  const many = (count: number): ImpactGraphDto =>
    graphWith(
      Array.from({ length: count }, (_unused, index) => currentNode(`current-${String(index)}`)),
      Array.from({ length: count }, (_unused, index) => proposedNode(`prop-${String(index)}`)),
      Array.from({ length: count }, (_unused, index) =>
        proposedEdge({
          id: `rel-${String(index)}`,
          sourceId: `current-${String(index)}`,
          targetId: `prop-${String(index)}`,
        }),
      ),
    );

  it('counts proposals against the cap instead of rendering them on top of it', () => {
    const oversized = many(150);
    const filters: GraphFilters = DEFAULT_FILTERS;
    const plan = planDisclosure({
      nodes: applyNodeFilters(structureNodes(oversized, 'both'), filters),
      filters,
      requirementLabels: labels,
      expandedGroupIds: new Set(),
    });
    // 300 nodes in total: over the budget, so everything collapses to group level and says so.
    expect(plan.matchedCount).toBe(300);
    expect(plan.budgetExceeded).toBe(true);
    expect(plan.visibleNodes).toHaveLength(0);
    expect(plan.collapsedGroups.map((group) => group.id)).toContain(PROPOSED_GROUP.id);
  });

  it('lets the proposed group be expanded on its own, still capped', () => {
    const oversized = many(150);
    const filters: GraphFilters = DEFAULT_FILTERS;
    const plan = planDisclosure({
      nodes: applyNodeFilters(structureNodes(oversized, 'both'), filters),
      filters,
      requirementLabels: labels,
      expandedGroupIds: new Set([PROPOSED_GROUP.id]),
    });
    expect(plan.visibleNodes.length).toBeLessThanOrEqual(MAX_VISIBLE_NODES);
    expect(plan.visibleNodes.every(isProposedNode)).toBe(true);
    expect(plan.hiddenCount).toBeGreaterThan(0);
  });

  it('never emits more node elements than the cap once proposals are included', () => {
    const nodeElements = elementsFor(many(150), 'both').filter(
      (element) => element.group === 'nodes' && element.classes !== 'group',
    );
    expect(nodeElements.length).toBeLessThanOrEqual(MAX_VISIBLE_NODES);
  });
});

describe('resolving a tapped element to the proposal it stands for', () => {
  it('finds relationships and components, and nothing else', () => {
    expect(findProposal(graph, 'rel-1')?.kind).toBe('relationship');
    expect(findProposal(graph, 'prop-1')?.kind).toBe('component');
    expect(findProposal(graph, 'current-a')).toBeUndefined();
    expect(findProposal({ ...graph, proposedStructure: undefined }, 'rel-1')).toBeUndefined();
  });
});
