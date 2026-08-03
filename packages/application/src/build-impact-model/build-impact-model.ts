import { createImpactAnalysis, err, validationError, validationIssue } from '@impactgraph/domain';

import { buildCoChangeIndex } from '../history/co-change-index.js';

import { traverseCandidates } from './candidate-traversal.js';
import { classifyCandidate } from './classification.js';
import { matchConcepts } from './concept-matching.js';
import { gateProposedStructure } from './proposed-structure-gate.js';

import type { ImpactCandidate, TraversalOptions } from './candidate-traversal.js';
import type { CoChangeIndex } from '../history/co-change-index.js';
import type {
  AnalysisWarning,
  ArchitecturalOption,
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  ProposedStructure,
  RequirementImpact,
  Result,
  Specification,
  ValidationError,
  ValidationIssue,
} from '@impactgraph/domain';

export interface BuildImpactModelRequest {
  readonly specification: Specification;
  readonly graph: KnowledgeGraph;
  readonly repositorySnapshotId: string;
  readonly analysisId: string;
  /** ISO timestamp from the clock port. */
  readonly createdAt: string;
  readonly aliases?: Readonly<Record<string, string>>;
  /** §Z9 learned exclusions from aliases.yml — suppressed impacts become warnings. */
  readonly excludedComponents?: readonly string[];
  /** Files-per-recent-commit for the §14 historical-co-change signal. */
  readonly history?: readonly (readonly string[])[];
  /** §C8 options produced by the clarification pipeline, bound into the analysis. */
  readonly architecturalOptions?: readonly ArchitecturalOption[];
  /** §18.4/§26 relationships the options would create — gated against the graph below. */
  readonly proposedStructure?: ProposedStructure | undefined;
  readonly traversal?: TraversalOptions;
}

/**
 * Evidence-validation gate (PRD §40.3, §43.2): every nodeId and dependencyPath hop must exist
 * in the graph at the bound snapshot. Exists as a separate gate because the future LLM pass
 * must go through it too — nothing reaches persistence unvalidated.
 */
export const validateImpactReferences = (
  impacts: readonly RequirementImpact[],
  graph: KnowledgeGraph,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  impacts.forEach((impact, index) => {
    if (!graph.nodes.has(impact.nodeId as NodeId)) {
      issues.push(
        validationIssue(
          'unknown-node-reference',
          `requirementImpacts[${String(index)}].nodeId`,
          `impact references nonexistent node '${impact.nodeId}'`,
        ),
      );
    }
    for (const hop of impact.dependencyPath) {
      if (!graph.nodes.has(hop as NodeId)) {
        issues.push(
          validationIssue(
            'unknown-node-reference',
            `requirementImpacts[${String(index)}].dependencyPath`,
            `dependency path references nonexistent node '${hop}'`,
          ),
        );
      }
    }
  });
  return issues;
};

const dedupeStrongest = (impacts: readonly RequirementImpact[]): RequirementImpact[] => {
  const best = new Map<string, RequirementImpact>();
  for (const impact of impacts) {
    const key = `${impact.requirementId}→${impact.nodeId}`;
    const existing = best.get(key);
    if (existing === undefined || impact.confidence > existing.confidence) {
      best.set(key, impact);
    }
  }
  return [...best.values()];
};

/**
 * The deterministic impact pipeline (PRD §13, §43.5): concepts → matches → bounded traversal →
 * rule classification → weighted confidence. Pure: identical spec + graph → identical analysis.
 */
interface RequirementPipeline {
  readonly request: BuildImpactModelRequest;
  readonly excluded: ReadonlySet<string>;
  readonly coChange: CoChangeIndex;
  readonly impacts: RequirementImpact[];
  readonly warnings: AnalysisWarning[];
}

/** §14: recent commits in which the candidate changed together with the matched component. */
const coChangeCountFor = (
  pipeline: RequirementPipeline,
  candidate: ImpactCandidate,
  node: GraphNode,
): number => {
  const matchedNode = pipeline.request.graph.nodes.get(candidate.match.nodeId as NodeId);
  return node.path !== undefined &&
    matchedNode?.path !== undefined &&
    node.path !== matchedNode.path
    ? pipeline.coChange.pairCount(node.path, matchedNode.path)
    : 0;
};

const classifyRequirementCandidates = (
  pipeline: RequirementPipeline,
  requirement: BuildImpactModelRequest['specification']['requirements'][number],
): void => {
  const { request, excluded, impacts, warnings } = pipeline;
  const matched = matchConcepts(request.graph, requirement.concepts, request.aliases ?? {});
  for (const unknown of matched.unknownConcepts) {
    warnings.push({
      code: 'unknown-concept',
      message: `no repository node matches concept '${unknown}'`,
      requirementId: requirement.id,
    });
  }
  const traversal = traverseCandidates(request.graph, matched.matches, request.traversal);
  if (traversal.cutoff) {
    warnings.push({
      code: 'traversal-cutoff',
      message: 'candidate limit reached — remote dependents omitted',
      requirementId: requirement.id,
    });
  }
  for (const candidate of traversal.candidates) {
    const node = request.graph.nodes.get(candidate.nodeId as NodeId);
    if (node === undefined) {
      continue;
    }
    if (excluded.has(node.name.toLowerCase())) {
      warnings.push({
        code: 'configured-exclusion',
        message: `impact on '${node.name}' suppressed by a learned exclusion (§Z9)`,
        requirementId: requirement.id,
      });
      continue;
    }
    const classified = classifyCandidate(candidate, node, requirement.id, {
      coChangeCount: coChangeCountFor(pipeline, candidate, node),
    });
    if (classified.ok) {
      impacts.push(classified.value);
    }
  }
};

export const buildImpactModel = (
  request: BuildImpactModelRequest,
): Result<ImpactAnalysis, ValidationError> => {
  const pipeline: RequirementPipeline = {
    request,
    excluded: new Set((request.excludedComponents ?? []).map((name) => name.toLowerCase())),
    coChange: buildCoChangeIndex(request.history ?? []),
    impacts: [],
    warnings: [],
  };

  for (const requirement of request.specification.requirements) {
    if (requirement.status !== 'rejected') {
      classifyRequirementCandidates(pipeline, requirement);
    }
  }

  const finalImpacts = dedupeStrongest(pipeline.impacts);
  const referenceIssues = validateImpactReferences(finalImpacts, request.graph);
  if (referenceIssues.length > 0) {
    return err(validationError(referenceIssues));
  }
  const options = [...(request.architecturalOptions ?? [])];
  const proposed = gateProposedStructure(
    request.proposedStructure,
    request.graph,
    new Set(options.map((option) => option.id)),
  );
  return createImpactAnalysis(
    {
      id: request.analysisId,
      specificationId: request.specification.id,
      specificationVersion: request.specification.version,
      repositorySnapshotId: request.repositorySnapshotId,
      createdAt: request.createdAt,
      status: 'draft',
      requirementImpacts: finalImpacts,
      architecturalOptions: options,
      warnings: [...pipeline.warnings, ...proposed.warnings],
      userDecisions: [],
      ...(proposed.structure === undefined ? {} : { proposedStructure: proposed.structure }),
    },
    { existingNodeIds: new Set(request.graph.nodes.keys()) },
  );
};
