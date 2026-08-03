import { computeImpactConfidence } from '@impactgraph/domain';

import type { ImpactCandidate } from './candidate-traversal.js';
import type {
  ConfidenceSignalType,
  GraphNode,
  ImpactDirectness,
  ImpactLikelihood,
  ImpactSignalInput,
  ImpactType,
  RequirementImpact,
  Result,
  ValidationError,
} from '@impactgraph/domain';

// Story 6.3 (deterministic mode) + 6.4 — rule-based classification with §14 signals. The LLM
// pass will re-rank this same bounded set later; the rules below are the provider-free floor.

const IMPACT_TYPE_BY_NODE_TYPE: Readonly<Record<string, ImpactType>> = {
  migration: 'migration',
  'api-endpoint': 'api-contract',
  controller: 'api-contract',
  handler: 'api-contract',
  job: 'background-processing',
  test: 'testing',
  page: 'read-model',
  'ui-component': 'read-model',
  form: 'read-model',
  policy: 'business-rule',
  invariant: 'business-rule',
  'business-rule': 'business-rule',
  'domain-event': 'event-contract',
  'external-api': 'integration',
  'third-party-service': 'integration',
  'deployment-pipeline': 'deployment',
};

const IMPACT_TYPE_BY_CATEGORY: Readonly<Record<string, ImpactType>> = {
  data: 'data-model',
  integration: 'event-contract',
  infrastructure: 'infrastructure',
};

export const impactTypeFor = (node: GraphNode): ImpactType =>
  IMPACT_TYPE_BY_NODE_TYPE[node.type] ?? IMPACT_TYPE_BY_CATEGORY[node.category] ?? 'domain-model';

const MECHANISM_SIGNAL: Readonly<Record<string, ConfidenceSignalType>> = {
  exact: 'exact-concept-to-symbol-match',
  alias: 'human-confirmed-mapping', // aliases are human-maintained config (PRD §17)
  'name-similarity': 'semantic-concept-match',
};

const EDGE_SIGNAL: Readonly<Partial<Record<string, ConfidenceSignalType>>> = {
  IMPORTS: 'direct-import',
  CALLS: 'direct-function-call',
  READS_FROM: 'direct-data-access',
  WRITES_TO: 'direct-data-access',
  PUBLISHES: 'event-relationship',
  SUBSCRIBES_TO: 'event-relationship',
  TESTS: 'test-association',
  DEPLOYED_AS: 'framework-convention',
};

export interface ClassifyContext {
  /** §14: recent commits in which this candidate changed together with the matched component. */
  readonly coChangeCount?: number | undefined;
}

export const signalsFor = (
  candidate: ImpactCandidate,
  context: ClassifyContext = {},
): ImpactSignalInput[] => {
  const signals: ImpactSignalInput[] = [
    {
      type: MECHANISM_SIGNAL[candidate.match.mechanism] ?? 'semantic-concept-match',
      description: `concept '${candidate.match.concept}' matched via ${candidate.match.mechanism}`,
    },
  ];
  for (const edgeType of new Set(candidate.edgeTypes)) {
    const signal = EDGE_SIGNAL[edgeType];
    if (signal !== undefined) {
      signals.push({ type: signal, description: `via ${edgeType}` });
    }
  }
  for (let hop = 0; hop < candidate.distance; hop += 1) {
    signals.push({ type: 'graph-distance', description: `hop ${String(hop + 1)}` });
  }
  const coChanges = context.coChangeCount ?? 0;
  if (candidate.distance > 0 && coChanges >= 2) {
    signals.push({
      type: 'historical-co-change',
      description: `changed together with the matched component in ${String(coChanges)} recent commits`,
    });
  }
  if (candidate.match.ambiguous) {
    signals.push({
      type: 'ambiguity',
      description: `concept '${candidate.match.concept}' matched multiple nodes`,
    });
  }
  return signals;
};

const likelihoodFor = (distance: number): ImpactLikelihood => {
  if (distance === 0) {
    return 'required';
  }
  return distance === 1 ? 'likely' : 'possible';
};

const explanationFor = (candidate: ImpactCandidate, node: GraphNode): string => {
  if (candidate.distance === 0) {
    return `Concept '${candidate.match.concept}' matches ${node.name} (${candidate.match.mechanism}).`;
  }
  return `Reached from concept '${candidate.match.concept}' via ${candidate.edgeTypes.join(' → ')} (${String(candidate.distance)} hop${candidate.distance > 1 ? 's' : ''}).`;
};

/** Deterministic rule-based classification — provenance stays `static-analysis` (§43.5). */
export const classifyCandidate = (
  candidate: ImpactCandidate,
  node: GraphNode,
  requirementId: string,
  context: ClassifyContext = {},
): Result<RequirementImpact, ValidationError> => {
  const confidence = computeImpactConfidence(signalsFor(candidate, context));
  if (!confidence.ok) {
    return confidence;
  }
  const directness: ImpactDirectness = candidate.distance === 0 ? 'direct' : 'indirect';
  const evidenceIds = [
    ...new Set([
      ...candidate.match.evidenceIds,
      ...candidate.edgeEvidenceIds,
      ...(node.knowledge.evidenceIds as readonly string[]),
    ]),
  ];
  return {
    ok: true,
    value: {
      requirementId,
      nodeId: candidate.nodeId,
      likelihood: likelihoodFor(candidate.distance),
      impactType: impactTypeFor(node),
      directness,
      confidence: confidence.value.value,
      confidenceSignals: confidence.value.signals,
      explanation: explanationFor(candidate, node),
      expectedChanges: [`Review ${node.name} against requirement ${requirementId}`],
      evidenceIds,
      dependencyPath: candidate.dependencyPath,
      provenance: 'static-analysis',
    },
  };
};
