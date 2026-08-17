import { capLikelihood, computeImpactConfidence } from '@impactgraph/domain';

import { obligationFor } from './change-kind.js';
import { basisFor } from './evidence-basis.js';
import { isOwnershipFamilyEdge } from './traversal-edge-semantics.js';

import type { ImpactCandidate } from './candidate-traversal.js';
import type { ChangeExpectationCue } from './change-expectation.js';
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
  // A unique scoped path resolution is the specification naming the file — identifier-grade.
  'path-suffix': 'exact-concept-to-symbol-match',
  // A bare filename names A file of that name, not THIS one — weaker than 0.9 by design.
  basename: 'basename-file-match',
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
  /**
   * ADR-0022: what the requirement says should HAPPEN at this surface, when it says so explicitly.
   * Only set for the anchor the reuse clause names, and only at distance 0 — a component reached
   * by traversal is not the component the sentence spoke about.
   */
  readonly changeExpectation?: ChangeExpectationCue | undefined;
}

/** Everything the concept match itself says about strength — mechanism plus its two penalties. */
const matchSignals = (match: ImpactCandidate['match'], node?: GraphNode): ImpactSignalInput[] => {
  const containerAnchor = node !== undefined && isContainerNameAnchor(match, node);
  const signals: ImpactSignalInput[] = [
    containerAnchor
      ? {
          type: 'container-name-match',
          description: `concept '${match.concept}' names the ${node.type} '${node.name}', not a specific change surface`,
        }
      : {
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
  node?: GraphNode,
): ImpactSignalInput[] => {
  // The mechanism signal describes the ANCHOR match; the container swap only applies when the
  // candidate IS the anchor (distance 0), never to nodes merely reached from one.
  const signals: ImpactSignalInput[] = matchSignals(
    candidate.match,
    candidate.distance === 0 ? node : undefined,
  );
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

/** Node kinds that contain other components rather than being one (§12.1 vocabulary). */
const CONTAINER_NODE_TYPES = new Set(['package', 'workspace', 'repository', 'directory']);

/** Mechanisms where the engine GUESSED which component the specification meant. */
const GUESSED_MECHANISMS = new Set<string>([
  'path-segment',
  'name-similarity',
  'basename',
  'semantic',
  'lexical',
]);

/**
 * A NAME match to a container-kind node is the specification naming the box, not a change surface
 * inside it — a product name matching its own package once anchored required/0.9 impacts on the
 * whole dependency cone. A path-shaped concept resolving to the container's manifest or path
 * stays strong: writing the path is naming the artifact.
 */
const isContainerNameAnchor = (match: ImpactCandidate['match'], node: GraphNode): boolean =>
  (match.mechanism === 'exact' || match.mechanism === 'alias') &&
  CONTAINER_NODE_TYPES.has(node.type) &&
  !match.concept.includes('/');

/**
 * Field finding: a fuzzy anchor walked CONTAINS up to its package and DEPENDS_ON up to every
 * dependent package, so 9 of 12 shown impacts were package manifests at `possible`. Ownership and
 * declaration edges locate where a guess lives; they do not make its whole dependency cone an
 * impact. Exact/alias anchors and any route with a non-ownership edge keep today's behavior.
 */
const isContainerFanOut = (candidate: ImpactCandidate, node: GraphNode): boolean =>
  candidate.distance > 0 &&
  CONTAINER_NODE_TYPES.has(node.type) &&
  GUESSED_MECHANISMS.has(candidate.match.mechanism) &&
  candidate.corroboratingEdgeTypes.length > 0 &&
  candidate.corroboratingEdgeTypes.every((type) => isOwnershipFamilyEdge(type));

/**
 * Whether anything ties a collided anchor to the requirement beyond its name: another concept of
 * the same requirement arriving at the node, or a propagating route from a different anchor.
 */
const collisionCorroborated = (candidate: ImpactCandidate): boolean =>
  candidate.propagationCorroborated ||
  candidate.anchorConcepts.some((concept) => concept !== candidate.match.concept);

interface LikelihoodProposal {
  readonly likelihood: ImpactLikelihood;
  /** When a guard demoted the tier, the sentence the explanation must carry (auditability). */
  readonly caveat?: string;
}

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
const anchorProposal = (candidate: ImpactCandidate, node: GraphNode): LikelihoodProposal => {
  const { collision } = candidate.match;
  // A collided exact match is one of N same-named coincidences until corroborated. Distance 0
  // proves the name exists, not that THIS copy is the component the requirement is about.
  if (collision !== undefined && !collisionCorroborated(candidate)) {
    return {
      likelihood: 'possible',
      caveat: `The name '${candidate.match.concept}' exists in ${String(collision.count)} places (${collision.containers.join(', ')}); nothing structural ties this one to the requirement.`,
    };
  }
  // "Required must mean strong": naming a container is not naming a change surface. A product
  // name matching its own package node once produced a required/0.9 impact for the whole repo.
  if (isContainerNameAnchor(candidate.match, node)) {
    return {
      likelihood: 'possible',
      caveat: `The specification names the container '${node.name}' (${node.type}), not a specific change surface within it.`,
    };
  }
  // An anchor is `required` only when the specification named it by identifier. A `semantic` or
  // `lexical` anchor means the engine GUESSED which component was meant, and guessing is not an
  // obligation — the tier ceiling for those bases holds it lower (item 3). A `name-similarity`
  // anchor proposes `required` and lets the `likely` ceiling cap it, so the record carries
  // `tierCappedBy` and the downgrade is auditable rather than silent (dogfooding item 4).
  return {
    likelihood:
      candidate.match.mechanism === 'semantic' || candidate.match.mechanism === 'lexical'
        ? 'possible'
        : 'required',
  };
};

const likelihoodFor = (
  candidate: ImpactCandidate,
  node: GraphNode,
  context: ClassifyContext,
  corroborated: boolean,
): LikelihoodProposal => {
  if (candidate.distance === 0) {
    return anchorProposal(candidate, node);
  }
  if (isContainerFanOut(candidate, node)) {
    // `unlikely` ranks below `possible`, so the default view's minLikelihood filter excludes it.
    return {
      likelihood: 'unlikely',
      caveat: 'Container reached only through ownership edges from a fuzzy name match.',
    };
  }
  // A directory-level match anchors the plan (hop 0: the container, the proposed-edge endpoint);
  // its NEIGHBOURHOOD is not an impact. Without this, one "apps/mcp-server" in prose put every
  // manifest, tsconfig and neighbour of four packages into the default view — 400 impacts, 396 of
  // them leads (the signal-over-volume failure this pass exists to avoid).
  if (candidate.match.mechanism === 'path-segment' && !corroborated) {
    return {
      likelihood: 'unlikely',
      caveat: 'Reached only by expanding a directory-level match.',
    };
  }
  if (candidate.distance > 1) {
    return { likelihood: 'possible' };
  }
  if (!candidate.weakLinkOnly || corroborated) {
    return { likelihood: 'likely' };
  }
  // The only link is a reverse call, import or use. Whether that obliges a change depends on the
  // shape of the change: a new method obliges no caller, a changed signature obliges every one.
  const change = context.change ?? { kind: 'unknown', compatibility: 'unknown', cue: 'not read' };
  // No recorded edge type means we cannot say what the relationship was, so it gets the weakest
  // reading rather than the reference default, which can still promote on a removal.
  return { likelihood: obligationFor(change, candidate.edgeTypes[0] ?? 'USES_UNKNOWN') };
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
  const confidence = computeImpactConfidence(signalsFor(candidate, context, node));
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
  const basis = basisFor(candidate, node);
  const proposal = likelihoodFor(candidate, node, context, (context.coChangeCount ?? 0) >= 2);
  const proposed = proposal.likelihood;
  const likelihood = capLikelihood(proposed, basis.evidenceTypes);
  const caveat = proposal.caveat === undefined ? '' : ` ${proposal.caveat}`;
  return {
    ok: true,
    value: {
      requirementId,
      nodeId: candidate.nodeId,
      likelihood,
      impactType: impactTypeFor(node),
      directness,
      confidence: confidence.value.value,
      confidenceSignals: confidence.value.signals,
      explanation: `${explanationFor(candidate, node, context)}${caveat} Basis: ${basis.primary}.`,
      expectedChanges: [
        context.changeExpectation === undefined || candidate.distance > 0
          ? `Review ${node.name} against requirement ${requirementId}`
          : `Plan expects no change here (${context.changeExpectation.expectation}, "${context.changeExpectation.cue}")`,
      ],
      evidenceIds,
      dependencyPath: candidate.dependencyPath,
      provenance: 'static-analysis',
      evidenceTypes: basis.evidenceTypes,
      ...(likelihood === proposed ? {} : { tierCappedBy: basis.primary }),
      ...(context.changeExpectation === undefined || candidate.distance > 0
        ? {}
        : { changeExpectation: context.changeExpectation.expectation }),
    },
  };
};
