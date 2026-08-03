import { confidenceLabel, presentationForCategory } from '../provenance.js';

import { applyEdgeFilters, groupFor } from './filters.js';
import {
  PROPOSED_BADGE,
  isProposedNode,
  proposedEdgeAria,
  proposedNodeAria,
  proposedRelationshipsFor,
} from './proposed.js';

import type { DisclosurePlan } from './disclosure.js';
import type { GraphFilters } from './filters.js';
import type { GraphViewNode, ProposedViewNode } from './proposed.js';
import type { ImpactGraphDto } from '@impactgraph/contracts';
import type { ElementDefinition } from 'cytoscape';

// ADR-0005 — compound Cytoscape elements. Pure mapping, tested headlessly: every visual channel
// that carries meaning (shape, border style, line treatment, badge text, screen-reader label) is
// decided here, so a test can assert the three knowledge categories AND the current/proposed
// split stay distinguishable without colour.

export interface ElementsInput {
  readonly graph: ImpactGraphDto;
  readonly plan: DisclosurePlan;
  readonly filters: GraphFilters;
  readonly requirementLabels: ReadonlyMap<string, string>;
}

const groupElements = (input: ElementsInput): ElementDefinition[] => {
  const used = new Set(
    input.plan.visibleNodes.map(
      (node) => groupFor(node, input.filters.groupBy, input.requirementLabels).id,
    ),
  );
  return input.plan.groups
    .filter((group) => used.has(group.id))
    .map((group) => ({
      group: 'nodes' as const,
      data: { id: group.id, label: group.label, kind: 'group' },
      classes: 'group',
    }));
};

/**
 * A proposed component keeps its knowledge shape and border — it is still AI-inferred knowledge
 * and §3 requires that to stay visible — and adds three further colour-independent channels: its
 * own compound parent, the word `[PROPOSED]` in the label, and a `proposed-node` class the
 * stylesheet draws with a ghosted outline.
 */
const proposedNodeElement = (node: ProposedViewNode, input: ElementsInput): ElementDefinition => {
  const presentation = presentationForCategory(node.knowledgeCategory);
  return {
    group: 'nodes' as const,
    data: {
      id: node.id,
      parent: groupFor(node, input.filters.groupBy, input.requirementLabels).id,
      label: `${node.name}\n[${PROPOSED_BADGE}] [${presentation.badge}]`,
      name: node.name,
      kind: 'proposed',
      state: 'proposed',
      knowledge: presentation.key,
      shape: presentation.shape,
      borderStyle: presentation.borderStyle,
      ariaLabel: proposedNodeAria(node.proposal),
    },
    classes: `proposed-node knowledge-${presentation.key}`,
  };
};

const currentNodeElement = (node: GraphViewNode, input: ElementsInput): ElementDefinition => {
  const presentation = presentationForCategory(node.knowledgeCategory);
  const group = groupFor(node, input.filters.groupBy, input.requirementLabels);
  return {
    group: 'nodes' as const,
    data: {
      id: node.id,
      parent: group.id,
      // The badge is part of the LABEL, not a colour: it survives grayscale (§37).
      label: `${node.name}\n[${presentation.badge}]`,
      name: node.name,
      kind: node.kind,
      state: 'current',
      knowledge: presentation.key,
      shape: presentation.shape,
      borderStyle: presentation.borderStyle,
      directness: node.directness ?? 'indirect',
      likelihood: node.likelihood ?? 'n/a',
      ariaLabel: [
        node.name,
        node.impactType ?? 'dependency path node',
        node.likelihood ?? 'no likelihood',
        node.directness ?? 'directness not reported',
        confidenceLabel(node.confidence),
        presentation.label,
      ].join(', '),
    },
    classes: `impact-node knowledge-${presentation.key} directness-${node.directness ?? 'indirect'}`,
  };
};

const nodeElements = (input: ElementsInput): ElementDefinition[] =>
  input.plan.visibleNodes.map((node) =>
    isProposedNode(node) ? proposedNodeElement(node, input) : currentNodeElement(node, input),
  );

const edgeElements = (input: ElementsInput): ElementDefinition[] => {
  const visible = new Set(input.plan.visibleNodes.map((node) => node.id));
  return applyEdgeFilters(input.graph.edges, visible).map((edge) => {
    const presentation = presentationForCategory(edge.knowledgeCategory);
    return {
      group: 'edges' as const,
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: `${edge.label} (${edge.directness}, ${presentation.badge.toLowerCase()})`,
        state: 'current',
        directness: edge.directness,
        knowledge: presentation.key,
        lineStyle: presentation.borderStyle === 'solid' ? 'solid' : 'dashed',
      },
      classes: `impact-edge knowledge-${presentation.key} directness-${edge.directness}`,
    };
  });
};

/**
 * §18.4 proposed relationships. They carry the `proposed-edge` class rather than `impact-edge`,
 * so they never inherit a current line treatment: the stylesheet gives them a fourth one (long
 * dash + a source arrow no current edge draws). The label leads with `[PROPOSED]`, and the
 * screen-reader sentence says "proposed relationship, not present in the repository" first.
 */
const proposedEdgeElements = (input: ElementsInput): ElementDefinition[] => {
  const visible = new Set(input.plan.visibleNodes.map((node) => node.id));
  return proposedRelationshipsFor(input.graph, input.filters.structure)
    .filter(
      (relationship) => visible.has(relationship.sourceId) && visible.has(relationship.targetId),
    )
    .map((relationship) => {
      const presentation = presentationForCategory(relationship.knowledgeCategory);
      return {
        group: 'edges' as const,
        data: {
          id: relationship.id,
          source: relationship.sourceId,
          target: relationship.targetId,
          label: `[${PROPOSED_BADGE}] ${relationship.type} (${presentation.badge.toLowerCase()})`,
          state: 'proposed',
          knowledge: presentation.key,
          lineStyle: 'long-dash',
          ariaLabel: proposedEdgeAria(relationship),
        },
        classes: `proposed-edge knowledge-${presentation.key}`,
      };
    });
};

export const buildElements = (input: ElementsInput): ElementDefinition[] => [
  ...groupElements(input),
  ...nodeElements(input),
  ...edgeElements(input),
  ...proposedEdgeElements(input),
];
