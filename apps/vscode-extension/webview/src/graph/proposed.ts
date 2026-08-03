import { confidenceLabel, presentationForCategory } from '../provenance.js';

import type {
  ImpactGraphDto,
  ImpactGraphNodeDto,
  ProposedGraphNodeDto,
  ProposedGraphRelationshipDto,
} from '@impactgraph/contracts';

// PRD §18.4 "display current and proposed relationships". The proposed half arrives in its own
// DTO field and stays in its own code path here: it is never appended to `graph.edges`, never
// styled like a current edge, and never described without the word "proposed" (§3).
//
// Everything in this file is pure so the four rules that matter can be asserted headlessly:
// the fourth line treatment, the PROPOSED text badge, the current/proposed/both filter, and the
// fact that a proposed element is announced as proposed to a screen reader.

/** The §18.4 diff control. `both` is the default so the two halves can be compared at a glance. */
export type StructureView = 'both' | 'current-only' | 'proposed-only';

export const STRUCTURE_VIEWS: readonly { value: StructureView; label: string }[] = [
  { value: 'both', label: 'Current and proposed' },
  { value: 'current-only', label: 'Current only' },
  { value: 'proposed-only', label: 'Proposed only' },
];

export const PROPOSED_BADGE = 'PROPOSED';

/**
 * A node as the graph pipeline sees it. A proposed component is NOT an `ImpactGraphNodeDto` —
 * it has no likelihood, no impact type and no place in the repository — so it enters the pipeline
 * as its own `kind`, carrying the record it stands for.
 */
export type CurrentViewNode = ImpactGraphNodeDto & { readonly proposal?: undefined };

export type ProposedViewNode = Omit<ImpactGraphNodeDto, 'kind'> & {
  readonly kind: 'proposed';
  /** The proposed component this node stands for. */
  readonly proposal: ProposedGraphNodeDto;
};

export type GraphViewNode = CurrentViewNode | ProposedViewNode;

export const isProposedNode = (node: GraphViewNode): node is ProposedViewNode =>
  node.kind === 'proposed';

/** Narrow back to the contract node type — proposed nodes never reach current-node surfaces. */
export const currentNodes = (nodes: readonly GraphViewNode[]): CurrentViewNode[] =>
  nodes.filter((node): node is CurrentViewNode => node.kind !== 'proposed');

/** Compound parent for proposed components: they group with each other, never into a context. */
export const PROPOSED_GROUP = {
  id: 'group:proposed',
  label: 'Proposed structure (not in the repository)',
} as const;

const toViewNode = (proposal: ProposedGraphNodeDto): ProposedViewNode => ({
  id: proposal.id,
  name: proposal.name,
  kind: 'proposed',
  requirementIds: [],
  confidence: proposal.confidence,
  provenance: proposal.provenance,
  ...(proposal.knowledgeCategory === undefined
    ? {}
    : { knowledgeCategory: proposal.knowledgeCategory }),
  proposal,
});

export const proposedViewNodes = (proposals: readonly ProposedGraphNodeDto[]): ProposedViewNode[] =>
  proposals.map(toViewNode);

/** Ids of the CURRENT components a proposed relationship attaches to. */
export const anchorIds = (
  relationships: readonly ProposedGraphRelationshipDto[],
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.sourceKind === 'existing') {
      ids.add(relationship.sourceId);
    }
    if (relationship.targetKind === 'existing') {
      ids.add(relationship.targetId);
    }
  }
  return ids;
};

export const proposedRelationshipsFor = (
  graph: ImpactGraphDto,
  view: StructureView,
): readonly ProposedGraphRelationshipDto[] =>
  view === 'current-only' ? [] : (graph.proposedStructure?.relationships ?? []);

/**
 * The candidate node list for the chosen view. `proposed-only` keeps the current components a
 * proposed relationship attaches to — an edge cannot be drawn without both endpoints, and hiding
 * the anchor would silently drop the very relationship the view exists to show.
 */
export const structureNodes = (graph: ImpactGraphDto, view: StructureView): GraphViewNode[] => {
  const relationships = proposedRelationshipsFor(graph, view);
  const anchors = anchorIds(relationships);
  const current =
    view === 'proposed-only' ? graph.nodes.filter((node) => anchors.has(node.id)) : graph.nodes;
  const proposed =
    view === 'current-only' ? [] : proposedViewNodes(graph.proposedStructure?.nodes ?? []);
  return [...current, ...proposed];
};

/** What the evidence panel is currently explaining, when it is explaining a proposal. */
export type ProposedSelection =
  | { readonly kind: 'relationship'; readonly record: ProposedGraphRelationshipDto }
  | { readonly kind: 'component'; readonly record: ProposedGraphNodeDto };

/** Resolve a tapped canvas element id to the proposal it stands for, if it is one. */
export const findProposal = (
  graph: ImpactGraphDto,
  elementId: string,
): ProposedSelection | undefined => {
  const structure = graph.proposedStructure;
  if (structure === undefined) {
    return undefined;
  }
  const relationship = structure.relationships.find((entry) => entry.id === elementId);
  if (relationship !== undefined) {
    return { kind: 'relationship', record: relationship };
  }
  const node = structure.nodes.find((entry) => entry.id === elementId);
  return node === undefined ? undefined : { kind: 'component', record: node };
};

/** The visible sentence for a proposed relationship — the same text the canvas label carries. */
export const proposedEdgeSummary = (relationship: ProposedGraphRelationshipDto): string =>
  `[${PROPOSED_BADGE}] ${relationship.sourceId} → ${relationship.targetId} (${relationship.type})`;

/** §37: a screen reader must hear "proposed" before anything else about the element. */
export const proposedEdgeAria = (relationship: ProposedGraphRelationshipDto): string =>
  [
    `Proposed relationship, not present in the repository: ${relationship.sourceId} to ${relationship.targetId}`,
    `type ${relationship.type}`,
    `source is an ${relationship.sourceKind} component, target is an ${relationship.targetKind} component`,
    `proposed by architectural option ${relationship.originOptionTitle ?? relationship.originOptionId}`,
    confidenceLabel(relationship.confidence),
    presentationForCategory(relationship.knowledgeCategory).label,
  ].join(', ');

export const proposedNodeAria = (proposal: ProposedGraphNodeDto): string =>
  [
    `Proposed component, would be created and does not exist in the repository: ${proposal.name}`,
    `${proposal.category} / ${proposal.type}`,
    `proposed by architectural option ${proposal.originOptionTitle ?? proposal.originOptionId}`,
    confidenceLabel(proposal.confidence),
    presentationForCategory(proposal.knowledgeCategory).label,
  ].join(', ');
