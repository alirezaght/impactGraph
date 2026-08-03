import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import { buildProposedStructure } from './proposed-model.js';

import type {
  CliAnalyzeOutput,
  ImpactGraphDto,
  ImpactGraphEdgeDto,
  ImpactGraphNodeDto,
} from '@impactgraph/contracts';

// Story 9.5 — pure projection of the versioned analyze document onto the §18.4 graph DTO.
// Mapping only: no impact is invented, reclassified, or hidden here. `dependencyPath` is the
// chain of graph node ids from the seed match to the impacted node, so its intermediate hops
// become their own nodes and "why is this affected" is walkable in the graph as in the tree.
//
// The visible-node cap and progressive disclosure live in the WEBVIEW (§43.1); this mapper
// reports `totalNodeCount` so "showing N of M" can never lie.

type ImpactDto = CliAnalyzeOutput['requirements'][number]['impacts'][number];

export const EMPTY_IMPACT_GRAPH: ImpactGraphDto = {
  schemaVersion: 1,
  status: 'empty',
  requirements: [],
  nodes: [],
  edges: [],
  totalNodeCount: 0,
  warnings: [],
};

const categoryOf = (provenance: string | undefined): string | undefined =>
  knowledgeCategoryForProvenance(provenance);

const impactNode = (impact: ImpactDto, requirementId: string): ImpactGraphNodeDto => {
  const category = categoryOf(impact.provenance);
  const file = impact.evidenceFiles.find((entry) => !entry.startsWith('commit '));
  return {
    id: impact.nodeId,
    name: impact.name,
    kind: 'impact',
    requirementIds: [requirementId],
    likelihood: impact.likelihood,
    impactType: impact.impactType,
    directness: impact.directness,
    confidence: impact.confidence,
    ...(impact.provenance === undefined ? {} : { provenance: impact.provenance }),
    ...(category === undefined ? {} : { knowledgeCategory: category }),
    ...(file === undefined ? {} : { filePath: file }),
    ...(impact.context === undefined ? {} : { context: impact.context }),
    ...(impact.application === undefined ? {} : { application: impact.application }),
  };
};

/** The full hop chain for one impact, always ending at the impacted node. */
const chainOf = (impact: ImpactDto): string[] => {
  const chain = [...impact.dependencyPath];
  if (chain[chain.length - 1] !== impact.nodeId) {
    chain.push(impact.nodeId);
  }
  return chain;
};

const pathEdges = (impact: ImpactDto): ImpactGraphEdgeDto[] => {
  const chain = chainOf(impact);
  const category = categoryOf(impact.provenance);
  const edges: ImpactGraphEdgeDto[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const sourceId = chain[index - 1];
    const targetId = chain[index];
    if (sourceId === undefined || targetId === undefined || sourceId === targetId) {
      continue;
    }
    edges.push({
      id: `${sourceId}->${targetId}`,
      sourceId,
      targetId,
      label: 'depends on',
      directness: index === chain.length - 1 ? impact.directness : 'indirect',
      ...(category === undefined ? {} : { knowledgeCategory: category }),
    });
  }
  return edges;
};

interface Collected {
  readonly impacts: Map<string, ImpactGraphNodeDto>;
  readonly hops: Map<string, ImpactGraphNodeDto>;
  readonly edges: Map<string, ImpactGraphEdgeDto>;
}

const addImpact = (collected: Collected, impact: ImpactDto, requirementId: string): void => {
  const node = impactNode(impact, requirementId);
  const existing = collected.impacts.get(node.id);
  collected.impacts.set(
    node.id,
    existing === undefined
      ? node
      : { ...existing, requirementIds: [...new Set([...existing.requirementIds, requirementId])] },
  );
  for (const hopId of chainOf(impact).slice(0, -1)) {
    const hop = collected.hops.get(hopId);
    collected.hops.set(hopId, {
      id: hopId,
      // Only the node id is available for an intermediate hop — no name is invented.
      name: hopId,
      kind: 'dependency',
      requirementIds: [...new Set([...(hop?.requirementIds ?? []), requirementId])],
    });
  }
  for (const edge of pathEdges(impact)) {
    collected.edges.set(edge.id, edge);
  }
};

export const buildImpactGraph = (document: CliAnalyzeOutput): ImpactGraphDto => {
  const collected: Collected = { impacts: new Map(), hops: new Map(), edges: new Map() };
  for (const requirement of document.requirements) {
    for (const impact of requirement.impacts) {
      addImpact(collected, impact, requirement.id);
    }
  }
  // A hop that is itself an impact is rendered as the impact — the richer record wins.
  const nodes = [
    ...collected.impacts.values(),
    ...[...collected.hops.values()].filter((hop) => !collected.impacts.has(hop.id)),
  ];
  const known = new Set(nodes.map((node) => node.id));
  // §18.4 current-vs-proposed: projected into its OWN field, never folded into `nodes`/`edges`.
  const proposed = buildProposedStructure(document, known);
  const hasContent = nodes.length > 0 || (proposed.structure?.relationships.length ?? 0) > 0;
  return {
    schemaVersion: 1,
    status: hasContent ? 'loaded' : 'empty',
    analysisId: document.analysis.id,
    snapshotId: document.analysis.snapshotId,
    specificationTitle: document.specification.title,
    requirements: document.requirements.map((requirement) => ({
      id: requirement.id,
      statement: requirement.statement,
    })),
    nodes,
    // An edge may only reference nodes that exist — the webview never invents an endpoint.
    edges: [...collected.edges.values()].filter(
      (edge) => known.has(edge.sourceId) && known.has(edge.targetId),
    ),
    // Proposed components are rendered and therefore count against the §33 budget, so the
    // "of M" the webview prints has to include them or the sentence would understate the graph.
    totalNodeCount: nodes.length + (proposed.structure?.nodes.length ?? 0),
    ...(proposed.structure === undefined ? {} : { proposedStructure: proposed.structure }),
    warnings: [...document.warnings, ...proposed.warnings],
  };
};
