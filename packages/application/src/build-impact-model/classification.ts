import { computeImpactConfidence } from '@impactgraph/domain';

import { obligationFor } from './change-kind.js';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { PredictedChange } from './change-kind.js';
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
  /** The change the requirement predicts, which decides what a reverse hop obliges. */
  readonly change?: PredictedChange | undefined;
}

/** Everything the concept match itself says about strength — mechanism plus its two penalties. */
const matchSignals = (match: ImpactCandidate['match']): ImpactSignalInput[] => {
  const signals: ImpactSignalInput[] = [
    {
      type: MECHANISM_SIGNAL[match.mechanism] ?? 'semantic-concept-match',
      description: `concept '${match.concept}' matched via ${match.mechanism}`,
    },
  ];
  if (match.ambiguous) {
    signals.push({
      type: 'ambiguity',
      description: `concept '${match.concept}' matched multiple nodes`,
    });
  }
  if (match.testOnly) {
    signals.push({
      type: 'test-only-match',
      description: `concept '${match.concept}' matched only test artifacts`,
    });
  }
  return signals;
};

export const signalsFor = (
  candidate: ImpactCandidate,
  context: ClassifyContext = {},
): ImpactSignalInput[] => {
  const signals: ImpactSignalInput[] = matchSignals(candidate.match);
  // Distinct relationship types across every route that reached this candidate — independent
  // evidence counts once per kind, never once per path.
  for (const edgeType of candidate.corroboratingEdgeTypes) {
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
  return signals;
};

/**
 * Structural reachability is evidence of POSSIBLE impact; it is not by itself enough for LIKELY.
 *
 * A candidate one hop out normally reads as likely, but not when the only thing connecting it to the
 * anchor is a reverse call, import, or use. Those prove coupling, not obligation: adding a method to
 * a class does not oblige its callers or its factory to change, and presenting them as likely
 * misrepresents structural connection as actionable guidance.
 *
 * Corroboration restores likely — a second independent route, a contract relationship such as
 * EXTENDS or IMPLEMENTS, or recent co-change history. Failing that, the predicted change kind
 * decides: an added method obliges no caller, a changed signature obliges every call site.
 */
const likelihoodFor = (
  candidate: ImpactCandidate,
  context: ClassifyContext,
  corroborated: boolean,
): ImpactLikelihood => {
  if (candidate.distance === 0) {
    return 'required';
  }
  if (candidate.distance > 1) {
    return 'possible';
  }
  if (!candidate.weakLinkOnly || corroborated) {
    return 'likely';
  }
  // The only link is a reverse call, import or use. Whether that obliges a change depends on the
  // shape of the change: a new method obliges no caller, a changed signature obliges every one.
  const change = context.change ?? { kind: 'unknown', compatibility: 'unknown', cue: 'not read' };
  return obligationFor(change, candidate.edgeTypes[0] ?? 'USES');
};

const explanationFor = (
  candidate: ImpactCandidate,
  node: GraphNode,
  context: ClassifyContext,
): string => {
  if (candidate.distance === 0) {
    return `Concept '${candidate.match.concept}' matches ${node.name} (${candidate.match.mechanism}).`;
  }
  const route = `Reached from concept '${candidate.match.concept}' via ${candidate.edgeTypes.join(' → ')} (${String(candidate.distance)} hop${candidate.distance > 1 ? 's' : ''}).`;
  // A promotion driven by the predicted change must say so, or nobody can audit it.
  if (!candidate.weakLinkOnly || context.change === undefined) {
    return route;
  }
  return `${route} Predicted change: ${context.change.kind} ("${context.change.cue}"), ${context.change.compatibility}.`;
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
      likelihood: likelihoodFor(candidate, context, (context.coChangeCount ?? 0) >= 2),
      impactType: impactTypeFor(node),
      directness,
      confidence: confidence.value.value,
      confidenceSignals: confidence.value.signals,
      explanation: explanationFor(candidate, node, context),
      expectedChanges: [`Review ${node.name} against requirement ${requirementId}`],
      evidenceIds,
      dependencyPath: candidate.dependencyPath,
      provenance: 'static-analysis',
    },
  };
};
