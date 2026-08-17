import { createImpactAnalysis, err, validationError, validationIssue } from '@impactgraph/domain';

import { isSpeculativeConcept } from '../analyze-specification/statement-analysis.js';
import { buildCoChangeIndex } from '../history/co-change-index.js';

import { traverseCandidates } from './candidate-traversal.js';
import { inferChange } from './change-kind.js';
import { classifyCandidate } from './classification.js';
import { matchConcepts } from './concept-matching.js';
import { applyNonGoalExclusions, resolveNonGoals } from './non-goal-exclusions.js';
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

/** Output-size limit (PRD §33 graph budget), applied after scoring — not a traversal control. */
const DEFAULT_MAX_CANDIDATES = 100;

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

const LIKELIHOOD_RANK: Readonly<Record<string, number>> = {
  required: 0,
  likely: 1,
  possible: 2,
  unlikely: 3,
};

const byStrength = (a: RequirementImpact, b: RequirementImpact): number =>
  b.confidence - a.confidence ||
  (LIKELIHOOD_RANK[a.likelihood] ?? 9) - (LIKELIHOOD_RANK[b.likelihood] ?? 9) ||
  a.nodeId.localeCompare(b.nodeId);

/**
 * The output cap, applied after scoring so it selects the strongest candidates rather than the
 * first-discovered ones. Two properties this protects:
 *
 * Anchors are never displaced. A component the specification named directly stays in the result
 * even when a broader concept produced hundreds of higher-scoring dependents — otherwise a
 * requirement can vanish from its own analysis.
 *
 * Raising the cap only appends. Sorting before truncation means the first N results are identical
 * at any limit above N, so a user who widens the limit sees more, never different.
 */
const capByStrength = (
  impacts: readonly RequirementImpact[],
  limit: number,
): { kept: RequirementImpact[]; dropped: number; highestDropped: number } => {
  const anchors = impacts.filter((impact) => impact.dependencyPath.length <= 1).sort(byStrength);
  const reached = impacts.filter((impact) => impact.dependencyPath.length > 1).sort(byStrength);
  const room = Math.max(0, limit - anchors.length);
  const kept = [...anchors.slice(0, limit), ...reached.slice(0, room)];
  const omitted = reached.slice(room);
  return {
    kept,
    dropped: impacts.length - kept.length,
    highestDropped: omitted[0]?.confidence ?? 0,
  };
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

/** Concepts that resolved to nothing, or to too much, are reported before any traversal runs. */
const recordMatchWarnings = (
  warnings: AnalysisWarning[],
  matched: ReturnType<typeof matchConcepts>,
  requirementId: string,
): void => {
  for (const unknown of matched.unknownConcepts) {
    // A speculative candidate (kebab-case prose, architectural noun phrase) was mined, not
    // asserted: it either resolves or it silently was never a concept. Warning on every
    // hyphenated English word would drown the identifiers the user actually wrote.
    if (isSpeculativeConcept(unknown)) {
      continue;
    }
    // Two warnings, deliberately. `unknown-concept` is the historical code consumers already
    // filter on; `unresolved-concept` is the item-2 promise — the specification named something
    // that does not exist in the graph, and ImpactGraph says so instead of inventing a node for it.
    warnings.push({
      code: 'unknown-concept',
      message: `no repository node matches concept '${unknown}'`,
      requirementId,
    });
    warnings.push({
      code: 'unresolved-concept',
      message: `'${unknown}' is named in the specification but matches no indexed repository artifact — it may be new, external, or outside the indexed scope. No node was created for it.`,
      requirementId,
    });
  }
  for (const ambiguous of matched.ambiguousConcepts) {
    // An ambiguous PATH lists the places it could mean, so the user answers a concrete question
    // ("which of these?") instead of re-deriving the collision themselves.
    const candidates = matched.pathCandidates.get(ambiguous);
    const listing = candidates === undefined ? '' : ` Candidates: ${candidates.join(', ')}.`;
    warnings.push({
      code: 'ambiguous-concept',
      message: `concept '${ambiguous}' matches too many unrelated components to anchor an impact — name the intended component.${listing}`,
      requirementId,
    });
  }
  for (const note of matched.eligibilityNotes) {
    warnings.push({ code: 'uncertain-eligibility', message: note, requirementId });
  }
};

/** Rule-based classification of every candidate, minus the §Z9 learned exclusions. */
const scoreCandidates = (
  pipeline: RequirementPipeline,
  requirement: BuildImpactModelRequest['specification']['requirements'][number],
  candidates: readonly ImpactCandidate[],
): RequirementImpact[] => {
  const requirementId = requirement.id;
  const change = inferChange(requirement.statement);
  const { request, excluded, warnings } = pipeline;
  const scored: RequirementImpact[] = [];
  for (const candidate of candidates) {
    const node = request.graph.nodes.get(candidate.nodeId as NodeId);
    if (node === undefined) {
      continue;
    }
    if (excluded.has(node.name.toLowerCase())) {
      warnings.push({
        code: 'configured-exclusion',
        message: `impact on '${node.name}' suppressed by a learned exclusion (§Z9)`,
        requirementId,
      });
      continue;
    }
    const classified = classifyCandidate(candidate, node, requirementId, {
      coChangeCount: coChangeCountFor(pipeline, candidate, node),
      change,
    });
    if (classified.ok) {
      scored.push(classified.value);
    }
  }
  return scored;
};

const classifyRequirementCandidates = (
  pipeline: RequirementPipeline,
  requirement: BuildImpactModelRequest['specification']['requirements'][number],
): void => {
  const { request, impacts, warnings } = pipeline;
  const matched = matchConcepts(request.graph, requirement.concepts, request.aliases ?? {});
  recordMatchWarnings(warnings, matched, requirement.id);
  const traversal = traverseCandidates(request.graph, matched.matches, request.traversal);
  if (traversal.exhausted) {
    warnings.push({
      code: 'traversal-exhausted',
      message:
        'traversal safety limit reached — the graph around this requirement is larger than the walk budget',
      requirementId: requirement.id,
    });
  }
  // `traversal.ownershipOnly` is deliberately NOT warned about. Declining to propagate out of a
  // container is a routine modelling rule that applies to almost every analysis — the same class of
  // decision as never walking CONTAINS downward, which has never warranted a warning. Routing it
  // through `warnings` would make `warningsFound` the normal exit code and devalue the signal. The
  // list stays on the traversal result for diagnostics and tests.
  const scored = scoreCandidates(pipeline, requirement, traversal.candidates);
  const capped = capByStrength(scored, request.traversal?.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  impacts.push(...capped.kept);
  if (capped.dropped > 0) {
    warnings.push({
      code: 'traversal-cutoff',
      message: `candidate limit reached — ${String(capped.dropped)} lower-confidence candidates omitted (highest omitted confidence ${capped.highestDropped.toFixed(2)})`,
      requirementId: requirement.id,
    });
  }
  if (capped.kept.length === 0) {
    // Silence here reads as "nothing changes for this requirement", which is a much stronger
    // claim than "the engine found nothing" (§C10 readiness depends on the difference).
    warnings.push({
      code: 'unmatched-requirement',
      message: 'no component could be tied to this requirement',
      requirementId: requirement.id,
    });
  }
};

/**
 * A provisional extraction taints everything derived from it (item 1). The warning rides on the
 * analysis so no consumer can present impacts over invented requirements as though they were over
 * the author's.
 */
const extractionWarnings = (specification: Specification): AnalysisWarning[] => {
  const quality = specification.extractionQuality;
  if (quality === undefined || !quality.provisional) {
    return [];
  }
  return [
    {
      code: 'provisional-extraction',
      message: `PROVISIONAL ANALYSIS: the specification declared no requirement list, so all ${String(quality.proseRequirementCount)} requirement(s) were cut out of prose by the extractor. Treat impacts and coverage below as indicative only.`,
    },
    ...quality.warnings.map((message) => ({ code: 'provisional-extraction' as const, message })),
  ];
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

  const exclusions = resolveNonGoals(request.specification, request.graph, request.aliases ?? {});
  const excluded = applyNonGoalExclusions(dedupeStrongest(pipeline.impacts), exclusions);
  pipeline.warnings.push(...excluded.warnings, ...extractionWarnings(request.specification));
  for (const { concept, statement } of exclusions.unresolved) {
    pipeline.warnings.push({
      code: 'unresolved-concept',
      message: `'${concept}' is named in the non-goal "${statement}" but matches no indexed artifact, so nothing was excluded on its behalf. No node was created for it.`,
    });
  }
  const finalImpacts = excluded.impacts;
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
