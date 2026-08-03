import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import type {
  CliAnalyzeOutput,
  ProposedGraphNodeDto,
  ProposedGraphRelationshipDto,
  ProposedStructureViewDto,
} from '@impactgraph/contracts';

// §18.4 current-vs-proposed — pure projection of the analyze document's `proposedStructure` onto
// the graph DTO's SEPARATE proposed channel. Nothing is merged into `nodes`/`edges` (§3): the
// whole feature is that the two halves can be diffed rather than blurred.
//
// Two rules are enforced here, and only these two — no proposal is invented, reclassified or
// re-scored:
//   1. A proposed node that reuses an id from the deterministic graph is DROPPED. Rendering it
//      would shadow a real component, which is exactly the merge this feature must not do.
//   2. A relationship with an endpoint that resolves to neither an existing graph node nor a
//      surviving proposed node is DROPPED. A dangling proposed edge is never rendered.
// Every drop produces a warning the panel shows — truncation is never silent (§43.1).

type AnalyzeProposedStructure = NonNullable<CliAnalyzeOutput['proposedStructure']>;
type AnalyzeProposedNode = AnalyzeProposedStructure['nodes'][number];
type AnalyzeProposedRelationship = AnalyzeProposedStructure['relationships'][number];

export interface ProposedProjection {
  readonly structure: ProposedStructureViewDto | undefined;
  readonly warnings: readonly string[];
}

/** Option titles by id, so the evidence panel can name the option instead of showing a bare id. */
const optionTitles = (document: CliAnalyzeOutput): ReadonlyMap<string, string> =>
  new Map((document.architecturalOptions ?? []).map((option) => [option.id, option.title]));

const envelopeOf = (
  record: AnalyzeProposedNode | AnalyzeProposedRelationship,
  titles: ReadonlyMap<string, string>,
): Omit<ProposedGraphNodeDto, 'id' | 'name' | 'category' | 'type'> => {
  const category = knowledgeCategoryForProvenance(record.provenance);
  const title = titles.get(record.originOptionId);
  return {
    originOptionId: record.originOptionId,
    ...(title === undefined ? {} : { originOptionTitle: title }),
    rationale: record.rationale,
    provenance: record.provenance,
    ...(category === undefined ? {} : { knowledgeCategory: category }),
    evidenceIds: [...record.evidenceIds],
    confidence: record.confidence,
    confidenceSignals: record.confidenceSignals.map((signal) => ({
      type: signal.type,
      contribution: signal.contribution,
      ...(signal.description === undefined ? {} : { description: signal.description }),
    })),
  };
};

const toNode = (
  node: AnalyzeProposedNode,
  titles: ReadonlyMap<string, string>,
): ProposedGraphNodeDto => ({
  id: node.id,
  name: node.name,
  category: node.category,
  type: node.type,
  ...envelopeOf(node, titles),
});

const toRelationship = (
  relationship: AnalyzeProposedRelationship,
  titles: ReadonlyMap<string, string>,
): ProposedGraphRelationshipDto => ({
  id: relationship.id,
  sourceId: relationship.sourceId,
  targetId: relationship.targetId,
  sourceKind: relationship.sourceKind,
  targetKind: relationship.targetKind,
  type: relationship.type,
  status: 'proposed',
  ...envelopeOf(relationship, titles),
});

interface Resolver {
  readonly existing: ReadonlySet<string>;
  readonly proposed: ReadonlySet<string>;
}

/** An endpoint resolves only against the collection its own `kind` names — never the other. */
const resolves = (id: string, kind: 'existing' | 'proposed', known: Resolver): boolean =>
  (kind === 'proposed' ? known.proposed : known.existing).has(id);

const unresolvedEndpoint = (
  relationship: AnalyzeProposedRelationship,
  known: Resolver,
): string | undefined => {
  if (!resolves(relationship.sourceId, relationship.sourceKind, known)) {
    return `${relationship.sourceKind} source '${relationship.sourceId}'`;
  }
  if (!resolves(relationship.targetId, relationship.targetKind, known)) {
    return `${relationship.targetKind} target '${relationship.targetId}'`;
  }
  return undefined;
};

const keepNodes = (
  structure: AnalyzeProposedStructure,
  existingNodeIds: ReadonlySet<string>,
  warnings: string[],
): AnalyzeProposedNode[] =>
  structure.nodes.filter((node) => {
    if (!existingNodeIds.has(node.id)) {
      return true;
    }
    warnings.push(
      `Proposed component '${node.id}' reuses the id of an existing component and was not shown — ` +
        'proposed structure is never merged into the current graph.',
    );
    return false;
  });

/**
 * Project the document's proposed structure. `existingNodeIds` are the ids the graph DTO will
 * actually carry, so an `existing` endpoint is checked against what the user can really see.
 */
export const buildProposedStructure = (
  document: CliAnalyzeOutput,
  existingNodeIds: ReadonlySet<string>,
): ProposedProjection => {
  const structure = document.proposedStructure;
  if (structure === undefined) {
    return { structure: undefined, warnings: [] };
  }
  const warnings: string[] = [];
  const titles = optionTitles(document);
  const nodes = keepNodes(structure, existingNodeIds, warnings);
  const known: Resolver = { existing: existingNodeIds, proposed: new Set(nodes.map((n) => n.id)) };
  const relationships: ProposedGraphRelationshipDto[] = [];
  for (const relationship of structure.relationships) {
    const unresolved = unresolvedEndpoint(relationship, known);
    if (unresolved === undefined) {
      relationships.push(toRelationship(relationship, titles));
      continue;
    }
    warnings.push(
      `Proposed relationship '${relationship.id}' was not shown: its ${unresolved} is not a ` +
        'component in this graph.',
    );
  }
  return {
    structure: { nodes: nodes.map((node) => toNode(node, titles)), relationships },
    warnings,
  };
};
