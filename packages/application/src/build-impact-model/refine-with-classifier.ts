import { createImpactAnalysis, IMPACT_LIKELIHOODS, IMPACT_TYPES, ok } from '@impactgraph/domain';

import type {
  ClassificationCandidate,
  ImpactClassification,
  ImpactClassificationPort,
} from './classification-port.js';
import type { ModelProviderError } from '../ports/model-provider.js';
import type {
  AnalysisWarning,
  ImpactAnalysis,
  ImpactLikelihood,
  ImpactType,
  KnowledgeGraph,
  NodeId,
  RequirementImpact,
  Result,
  Specification,
  ValidationError,
} from '@impactgraph/domain';

// Story 6.3, stage two: the LLM re-classifies the deterministic impacts (the bounded candidate
// set). Valid classifications become `llm-inferred` records; references outside the set are
// rejected as warnings (§43.2); everything unclassified keeps its deterministic form. AI
// failure leaves the deterministic analysis fully usable (PRD §8, §34).

export interface RefineOutcome {
  readonly analysis: ImpactAnalysis;
  readonly classificationMode: 'llm' | 'deterministic-only';
  readonly providerError?: ModelProviderError;
}

const candidateFor = (
  impact: RequirementImpact,
  graph: KnowledgeGraph,
): ClassificationCandidate => {
  const node = graph.nodes.get(impact.nodeId as NodeId);
  const pathNames = impact.dependencyPath.map((hop) => graph.nodes.get(hop as NodeId)?.name ?? hop);
  return {
    nodeId: impact.nodeId,
    name: node?.name ?? impact.nodeId,
    nodeType: node?.type ?? 'unknown',
    category: node?.category ?? 'unknown',
    distance: impact.dependencyPath.length - 1,
    path: pathNames.join(' → '),
  };
};

const applyClassification = (
  impact: RequirementImpact,
  classification: ImpactClassification,
): RequirementImpact | undefined => {
  const validLikelihood = (IMPACT_LIKELIHOODS as readonly string[]).includes(
    classification.likelihood,
  );
  const validType = (IMPACT_TYPES as readonly string[]).includes(classification.impactType);
  if (!validLikelihood || !validType) {
    return undefined;
  }
  return {
    ...impact,
    likelihood: classification.likelihood as ImpactLikelihood,
    impactType: classification.impactType as ImpactType,
    explanation: classification.explanation,
    expectedChanges: classification.expectedChanges,
    // Confidence and its signals stay computed (§14) — the model never sets the number.
    provenance: 'llm-inferred',
  };
};

const mergeRequirement = (
  impacts: readonly RequirementImpact[],
  classifications: readonly ImpactClassification[],
  requirementId: string,
  warnings: AnalysisWarning[],
): RequirementImpact[] => {
  const byNodeId = new Map(impacts.map((impact) => [impact.nodeId, impact]));
  for (const classification of classifications) {
    const impact = byNodeId.get(classification.nodeId);
    if (impact === undefined) {
      warnings.push({
        code: 'invalid-reference',
        message: `model referenced node '${classification.nodeId}' outside the candidate set — rejected`,
        requirementId,
      });
      continue;
    }
    const refined = applyClassification(impact, classification);
    if (refined === undefined) {
      warnings.push({
        code: 'unsupported-claim',
        message: `model classification for '${classification.nodeId}' failed taxonomy validation — kept deterministic result`,
        requirementId,
      });
      continue;
    }
    byNodeId.set(classification.nodeId, refined);
  }
  return [...byNodeId.values()];
};

/**
 * Refine a deterministic draft analysis with LLM classifications. Returns a new draft; the
 * input analysis is untouched. Any provider failure returns the deterministic analysis with
 * the error surfaced — never a broken result.
 */
export const refineWithClassifier = async (
  analysis: ImpactAnalysis,
  specification: Specification,
  graph: KnowledgeGraph,
  classifier: ImpactClassificationPort,
): Promise<Result<RefineOutcome, ValidationError>> => {
  const warnings: AnalysisWarning[] = [...analysis.warnings];
  const refinedImpacts: RequirementImpact[] = [];
  let providerError: ModelProviderError | undefined;

  for (const requirement of specification.requirements) {
    const impacts = analysis.requirementImpacts.filter(
      (impact) => impact.requirementId === requirement.id,
    );
    if (impacts.length === 0 || providerError !== undefined) {
      refinedImpacts.push(...impacts);
      continue;
    }
    const classified = await classifier.classify({
      requirementId: requirement.id,
      requirementStatement: requirement.statement,
      candidates: impacts.map((impact) => candidateFor(impact, graph)),
    });
    if (!classified.ok) {
      providerError = classified.error;
      refinedImpacts.push(...impacts);
      continue;
    }
    refinedImpacts.push(...mergeRequirement(impacts, classified.value, requirement.id, warnings));
  }

  if (providerError !== undefined) {
    return ok({ analysis, classificationMode: 'deterministic-only', providerError });
  }
  const refined = createImpactAnalysis(
    {
      ...analysis,
      requirementImpacts: refinedImpacts,
      warnings,
    },
    // The §18.4 proposed structure rides through untouched, but the grounding gate is re-applied
    // against the same snapshot graph — no rebuild of an analysis ever skips it (§34).
    { existingNodeIds: new Set(graph.nodes.keys()) },
  );
  if (!refined.ok) {
    return refined;
  }
  return ok({ analysis: refined.value, classificationMode: 'llm' });
};
