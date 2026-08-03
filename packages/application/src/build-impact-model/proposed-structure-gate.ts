import { collectProposedStructureIssues } from '@impactgraph/domain';

import type {
  AnalysisWarning,
  KnowledgeGraph,
  ProposedNode,
  ProposedRelationship,
  ProposedStructure,
} from '@impactgraph/domain';

// The §34 grounding gate for the proposed half of an analysis: a proposed record may only cite
// nodes that exist in the deterministic graph at the bound snapshot, or proposed nodes declared
// in the very same structure. A record that fails is DROPPED and the rejection is recorded as a
// warning — never silently discarded, never repaired into something the engine can accept, and
// never promoted alongside deterministic facts. `createImpactAnalysis` re-checks what survives,
// so a bug here fails the analysis loudly instead of persisting unverified structure.

export interface ProposedStructureGateResult {
  readonly structure: ProposedStructure | undefined;
  readonly warnings: readonly AnalysisWarning[];
}

const rejectionWarning = (kind: string, id: string, reason: string): AnalysisWarning => ({
  code: 'invalid-reference',
  message: `proposed ${kind} '${id}' rejected: ${reason}`,
});

export const gateProposedStructure = (
  structure: ProposedStructure | undefined,
  graph: KnowledgeGraph,
  optionIds: ReadonlySet<string>,
): ProposedStructureGateResult => {
  if (structure === undefined) {
    return { structure: undefined, warnings: [] };
  }
  const context = {
    existingNodeIds: new Set<string>(graph.nodes.keys()),
    optionIds,
  };
  const warnings: AnalysisWarning[] = [];
  const nodes: ProposedNode[] = [];
  for (const node of structure.nodes) {
    const issues = collectProposedStructureIssues(
      { nodes: [node], relationships: [] },
      context,
      'p',
    );
    if (issues.length === 0) {
      nodes.push(node);
    } else {
      warnings.push(rejectionWarning('node', node.id, issues[0]?.message ?? 'invalid'));
    }
  }
  const relationships: ProposedRelationship[] = [];
  for (const relationship of structure.relationships) {
    const issues = collectProposedStructureIssues(
      { nodes, relationships: [relationship] },
      context,
      'p',
    );
    if (issues.length === 0) {
      relationships.push(relationship);
    } else {
      warnings.push(
        rejectionWarning('relationship', relationship.id, issues[0]?.message ?? 'invalid'),
      );
    }
  }
  return { structure: { nodes, relationships }, warnings };
};
