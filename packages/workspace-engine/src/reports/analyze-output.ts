import { computeReadiness } from '@impactgraph/domain';

import type { CliAnalyzeOutput } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, NodeId, Specification } from '@impactgraph/domain';

// The §46 analyze document builder — shared by `impactgraph analyze` and the MCP
// analyze_impact tool (identical contract, ADR-0009).

export interface AnalyzeOutputInput {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly evidenceFileById: ReadonlyMap<string, string>;
  readonly extractionMode: CliAnalyzeOutput['specification']['extractionMode'];
  /** §18.4: effective context per node id, from the §Z5 overlay. Absent → no grouping data. */
  readonly contextByNodeId?: ReadonlyMap<string, string> | undefined;
  /** §18.4: owning package/workspace per node id. Absent → no application grouping data. */
  readonly applicationByNodeId?: ReadonlyMap<string, string> | undefined;
}

/** §C8 options ride along only when they exist — the field stays absent otherwise. */
const optionsBlock = (
  analysis: ImpactAnalysis,
): Pick<CliAnalyzeOutput, 'architecturalOptions'> | Record<string, never> =>
  analysis.architecturalOptions.length === 0
    ? {}
    : {
        architecturalOptions: analysis.architecturalOptions.map((option) => ({
          id: option.id,
          title: option.title,
          description: option.description,
          affectedNodeIds: [...option.affectedNodeIds],
          ...(option.linkedQuestionId === undefined
            ? {}
            : { linkedQuestionId: option.linkedQuestionId }),
          ...(option.implications === undefined
            ? {}
            : {
                implications: {
                  ...option.implications,
                  dataChanges: [...option.implications.dataChanges],
                  contractChanges: [...option.implications.contractChanges],
                  infrastructureChanges: [...option.implications.infrastructureChanges],
                  testingImpact: [...option.implications.testingImpact],
                  risks: [...option.implications.risks],
                },
              }),
        })),
      };

/**
 * §18.4: the proposed half of the architecture, emitted in its own field so a consumer can DIFF
 * current against proposed instead of merging them. Absent when the engine proposed nothing.
 */
const proposedBlock = (
  analysis: ImpactAnalysis,
): Pick<CliAnalyzeOutput, 'proposedStructure'> | Record<string, never> => {
  const structure = analysis.proposedStructure;
  if (
    structure === undefined ||
    (structure.nodes.length === 0 && structure.relationships.length === 0)
  ) {
    return {};
  }
  return {
    proposedStructure: {
      nodes: structure.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        category: node.category,
        type: node.type,
        originOptionId: node.originOptionId,
        rationale: node.rationale,
        provenance: node.provenance,
        evidenceIds: [...node.evidenceIds],
        confidence: node.confidence,
        confidenceSignals: node.confidenceSignals.map((signal) => ({ ...signal })),
      })),
      relationships: structure.relationships.map((relationship) => ({
        id: relationship.id,
        sourceId: relationship.sourceId,
        targetId: relationship.targetId,
        sourceKind: relationship.sourceKind,
        targetKind: relationship.targetKind,
        type: relationship.type,
        status: relationship.status,
        originOptionId: relationship.originOptionId,
        rationale: relationship.rationale,
        provenance: relationship.provenance,
        evidenceIds: [...relationship.evidenceIds],
        confidence: relationship.confidence,
        confidenceSignals: relationship.confidenceSignals.map((signal) => ({ ...signal })),
      })),
    },
  };
};

export const buildAnalyzeOutput = ({
  specification,
  analysis,
  graph,
  evidenceFileById,
  extractionMode,
  contextByNodeId,
  applicationByNodeId,
}: AnalyzeOutputInput): CliAnalyzeOutput => ({
  schemaVersion: 1,
  command: 'analyze',
  specification: {
    id: specification.id,
    version: specification.version,
    title: specification.title,
    extractionMode,
    readiness: computeReadiness(specification),
  },
  analysis: {
    id: analysis.id,
    snapshotId: analysis.repositorySnapshotId,
    status: analysis.status,
    impactCount: analysis.requirementImpacts.length,
  },
  requirements: specification.requirements.map((requirement) => ({
    id: requirement.id,
    statement: requirement.statement,
    impacts: analysis.requirementImpacts
      .filter((impact) => impact.requirementId === requirement.id)
      .map((impact) => ({
        nodeId: impact.nodeId,
        name: graph.nodes.get(impact.nodeId as NodeId)?.name ?? impact.nodeId,
        likelihood: impact.likelihood,
        impactType: impact.impactType,
        directness: impact.directness,
        confidence: impact.confidence,
        dependencyPath: [...impact.dependencyPath],
        evidenceFiles: [
          ...new Set(
            impact.evidenceIds
              .map((id) => evidenceFileById.get(id))
              .filter((file): file is string => file !== undefined),
          ),
        ],
        provenance: impact.provenance,
        ...(contextByNodeId?.get(impact.nodeId) === undefined
          ? {}
          : { context: contextByNodeId.get(impact.nodeId) }),
        ...(applicationByNodeId?.get(impact.nodeId) === undefined
          ? {}
          : { application: applicationByNodeId.get(impact.nodeId) }),
      })),
    openQuestions: specification.openQuestions
      .filter((question) => question.affectedRequirementIds.includes(requirement.id))
      .map((question) => ({ question: question.question, severity: question.severity })),
  })),
  warnings: analysis.warnings.map((warning) => warning.message),
  ...optionsBlock(analysis),
  ...proposedBlock(analysis),
});
