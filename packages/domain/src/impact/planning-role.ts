import { likelihoodRank, primaryEvidenceType } from './evidence-basis.js';

import type { ImpactEvidenceType } from './evidence-basis.js';
import type {
  ChangeExpectation,
  ImpactDirectness,
  ImpactLikelihood,
  ImpactType,
} from './impact-analysis.js';
import type { EvidenceProvenance } from '../preflight/evidence-provenance.js';

/**
 * WHAT A RECORD IS FOR, as distinct from how strongly it is implicated.
 *
 * The existing axes each answer a different question — `likelihood` how strongly a surface is
 * implicated, `evidenceTypes` why, `evidenceProvenance` where the evidence came from,
 * `changeExpectation` what should happen there. None of them answers the question a reader opens
 * the analysis with: *is this something I have to think about before I implement?*
 *
 * `possible` is the proof that the question was missing. Its own definition says it is not a
 * prediction of change — it is "something reachable from something implicated" — yet it sits inside
 * `PREDICTIVE_LIKELIHOODS` and therefore dominates every default view, because reachability is
 * cheap and obligation is not. A field run produced 106 impacts of which 11 were concept matches
 * and 95 were traversal expansion; every one of the 95 was factually true and none of them was a
 * planning decision.
 *
 * The fix is not a node cap and not a smaller `maxDepth`. Truncation picks by score, and score
 * cannot tell "the payment webhook now receives a new field" (two hops, must plan for it) from
 * "a test helper imports the module we are touching" (one hop, nothing to decide). The role axis
 * makes that distinction explicit, derives it from evidence already on the record, and states
 * which rule decided — so a reader can disagree with the classification rather than reverse-engineer
 * it.
 */
export const PLANNING_ROLES = [
  /** Evidence that this surface matters to satisfying the specification. The primary answer. */
  'planning-impact',
  /** Structurally reachable, insufficient evidence of impact. Kept for investigation and audit. */
  'dependency-context',
  /** A name or meaning resemblance. Worth checking, never worth planning around. */
  'investigation-lead',
] as const;

export type PlanningRole = (typeof PLANNING_ROLES)[number];

export const isPlanningRole = (value: unknown): value is PlanningRole =>
  typeof value === 'string' && (PLANNING_ROLES as readonly string[]).includes(value);

/**
 * The closed set of reasons a role can be assigned. Naming the deciding rule is what makes the
 * classification auditable: "why is this in my plan" has one answer, and it is testable.
 */
export const PLANNING_ROLE_RULES = [
  'non-goal-excluded',
  'regression-boundary',
  'adversarially-derived',
  'named-by-specification',
  'resolved-by-resemblance',
  'resemblance-only',
  'structural-obligation',
  'architectural-consequence',
  'reachable-only',
] as const;

export type PlanningRoleRule = (typeof PLANNING_ROLE_RULES)[number];

export interface PlanningRoleVerdict {
  readonly role: PlanningRole;
  readonly rule: PlanningRoleRule;
  /** One sentence, addressed to a planner, stating why the record landed where it did. */
  readonly reason: string;
}

/** Everything the decision reads. All of it already lives on a stored impact record. */
export interface PlanningRoleInput {
  readonly likelihood: ImpactLikelihood;
  readonly evidenceTypes: readonly ImpactEvidenceType[];
  readonly evidenceProvenance: EvidenceProvenance;
  readonly impactType: ImpactType;
  readonly changeExpectation: ChangeExpectation;
  /** `direct` means the concept resolved to THIS node; `indirect` means traversal reached it. */
  readonly directness: ImpactDirectness;
}

/** Bases that establish a traversed or declared relationship rather than a resemblance. */
const STRUCTURAL_BASES: ReadonlySet<ImpactEvidenceType> = new Set([
  'direct-structural',
  'transitive-structural',
  'async-event',
  'external-contract',
  'field-data-flow',
  'configuration-asset',
]);

/**
 * Bases whose route left the local code neighbourhood — it crossed a queue, a service contract, a
 * named data field, or a configuration surface. These are the consequences a reader cannot get by
 * reading the specification's own filenames, which is exactly what the primary graph is for.
 */
const BOUNDARY_BASES: ReadonlySet<ImpactEvidenceType> = new Set([
  'async-event',
  'external-contract',
  'field-data-flow',
  'configuration-asset',
]);

/**
 * Impact types whose surface carries a contract beyond the module that owns it: changing one is a
 * decision with blast radius, so reaching one is worth planning around even at `possible`.
 *
 * `domain-model` is deliberately absent — it is the fallback type for every node the classifier
 * could not otherwise place, so admitting it would readmit the whole traversal. `read-model`,
 * `testing`, `documentation`, `observability` and `performance` are absent because reaching them
 * is a consequence of the change, not a decision to be taken before it.
 */
const CONSEQUENCE_IMPACT_TYPES: ReadonlySet<ImpactType> = new Set<ImpactType>([
  'api-contract',
  'data-model',
  'migration',
  'event-contract',
  'background-processing',
  'integration',
  'security',
  'infrastructure',
  'deployment',
  'business-rule',
]);

/** Provenances produced only by the adversarial passes — a constraint or the runtime topology. */
const ADVERSARIAL_PROVENANCES: ReadonlySet<EvidenceProvenance> = new Set<EvidenceProvenance>([
  'CONSTRAINT_DERIVED',
  'RUNTIME_DERIVED',
]);

const STRONG_TIER_CEILING = likelihoodRank('likely');
const PREDICTIVE_CEILING = likelihoodRank('possible');

const isStrongTier = (likelihood: ImpactLikelihood): boolean =>
  likelihoodRank(likelihood) <= STRONG_TIER_CEILING;

const isPredictive = (likelihood: ImpactLikelihood): boolean =>
  likelihoodRank(likelihood) <= PREDICTIVE_CEILING;

const verdict = (
  role: PlanningRole,
  rule: PlanningRoleRule,
  reason: string,
): PlanningRoleVerdict => ({ role, rule, reason });

/**
 * The rule ladder, first match wins. Ordering carries meaning:
 *
 * The three promotions come first because each of them describes a planning obligation that the
 * tier alone would understate — a surface the author FORBADE changing, a surface an adversarial
 * pass derived, a surface the specification named outright. Demotions follow, so a resemblance can
 * never be talked up. The two remaining promotions then separate obligation and consequence from
 * plain reachability, and everything left over is context.
 */
export const derivePlanningRole = (input: PlanningRoleInput): PlanningRoleVerdict => {
  const basis = primaryEvidenceType(input.evidenceTypes);
  if (input.likelihood === 'excluded') {
    return verdict(
      'dependency-context',
      'non-goal-excluded',
      'A specification non-goal rules this component out; it is kept so the exclusion is auditable.',
    );
  }
  if (input.changeExpectation === 'preserve') {
    return verdict(
      'planning-impact',
      'regression-boundary',
      'The specification protects this surface — it is a regression boundary the implementation must respect.',
    );
  }
  if (ADVERSARIAL_PROVENANCES.has(input.evidenceProvenance)) {
    return verdict(
      'planning-impact',
      'adversarially-derived',
      input.evidenceProvenance === 'CONSTRAINT_DERIVED'
        ? 'A repository constraint or guard selected this component — an invariant the plan has to satisfy.'
        : 'The runtime or deployment topology selected this component, not a source-level dependency.',
    );
  }
  if (input.evidenceProvenance === 'USER_SUPPLIED' && isStrongTier(input.likelihood)) {
    return verdict(
      'planning-impact',
      'named-by-specification',
      'The specification names this component outright — confirmation, and still a surface to plan.',
    );
  }
  return derivedRole(input, basis);
};

/** The evidence-driven half of the ladder, split out to keep each function single-purpose. */
const derivedRole = (input: PlanningRoleInput, basis: ImpactEvidenceType): PlanningRoleVerdict => {
  if (!STRUCTURAL_BASES.has(basis)) {
    return resemblanceRole(input, basis);
  }
  if (isStrongTier(input.likelihood)) {
    return verdict(
      'planning-impact',
      'structural-obligation',
      `Structural evidence (${basis}) puts this at '${input.likelihood}' — the change is expected to land here.`,
    );
  }
  if (isPredictive(input.likelihood) && BOUNDARY_BASES.has(basis)) {
    return verdict(
      'planning-impact',
      'architectural-consequence',
      `Reached across an architectural boundary (${basis}) — the consequence leaves the local code neighbourhood.`,
    );
  }
  if (isPredictive(input.likelihood) && CONSEQUENCE_IMPACT_TYPES.has(input.impactType)) {
    return verdict(
      'planning-impact',
      'architectural-consequence',
      `Reachable, and the surface reached is a ${input.impactType} — a contract whose change has consequences beyond the module that owns it.`,
    );
  }
  return verdict(
    'dependency-context',
    'reachable-only',
    'Structurally reachable from an implicated component over ordinary code dependencies; nothing establishes that it has to change.',
  );
};

/**
 * What to do with a finding the engine reached by resemblance rather than by relationship.
 *
 * The distinction is WHERE the resemblance sits. At distance 0 it is the engine's identification of
 * the component the specification is talking about — "the `Base` helper" resolving to `BaseService`
 * is a guess, but it is a guess about the SUBJECT, and hiding it leaves the reader with an empty
 * plan and nothing to correct. Past distance 0 the guess has been compounded by traversal: the
 * route is only as strong as the link that attached it to the specification, so "everything
 * reachable from something that shares a word with the spec" is exactly the noise this axis exists
 * to remove.
 *
 * A resemblance-resolved subject therefore stays in the plan, on its own rule, and only at a tier
 * the basis could earn — so the evidence-quality verdict still calls the view weak, and the reader
 * is told to confirm the name before acting on it.
 */
const resemblanceRole = (
  input: PlanningRoleInput,
  basis: ImpactEvidenceType,
): PlanningRoleVerdict => {
  const how = basis === 'lexical-only' ? 'text overlap' : 'name or meaning resemblance';
  if (input.directness === 'direct' && isStrongTier(input.likelihood)) {
    return verdict(
      'planning-impact',
      'resolved-by-resemblance',
      `The specification did not name this component — the engine matched it by ${how}. It is the best available reading of what the requirement is about; confirm the name before acting on it.`,
    );
  }
  // A LEAD, not context: context means "we know how this connects and it does not oblige a
  // change", and here nothing connects at all. Conflating the two would let a reader browsing
  // dependency context mistake a coincidence for a traced relationship.
  return verdict(
    'investigation-lead',
    'resemblance-only',
    `Reached through a ${how} rather than a relationship — no route from anything the specification named was established.`,
  );
};

export interface PlanningSignal {
  readonly planningImpactCount: number;
  readonly dependencyContextCount: number;
  readonly investigationLeadCount: number;
  readonly totalCount: number;
  /**
   * Share of the analysis that is a planning decision, 0..1, rounded to two places. Reported
   * rather than optimised: a low ratio on a broad specification is honest, and hiding it would
   * turn "we looked at a lot and little of it matters" into "we found little".
   */
  readonly planningShare: number;
  /** The one deterministic sentence every surface repeats, so none of them invents its own. */
  readonly statement: string;
}

const share = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 100) / 100;

export const summarisePlanningRoles = (roles: readonly PlanningRole[]): PlanningSignal => {
  const planningImpactCount = roles.filter((role) => role === 'planning-impact').length;
  const dependencyContextCount = roles.filter((role) => role === 'dependency-context').length;
  const investigationLeadCount = roles.filter((role) => role === 'investigation-lead').length;
  const totalCount = roles.length;
  return {
    planningImpactCount,
    dependencyContextCount,
    investigationLeadCount,
    totalCount,
    planningShare: share(planningImpactCount, totalCount),
    statement:
      totalCount === 0
        ? 'The analysis produced no impacts, so there is nothing to prioritise.'
        : `${String(planningImpactCount)} of ${String(totalCount)} findings are planning decisions; ${String(dependencyContextCount)} are dependency context and ${String(investigationLeadCount)} are leads — both kept, neither shown first.`,
  };
};

/** Strongest-first ordering, so a mixed list still leads with what a reader must act on. */
const ROLE_RANK: Readonly<Record<PlanningRole, number>> = {
  'planning-impact': 0,
  'dependency-context': 1,
  'investigation-lead': 2,
};

export const planningRoleRank = (role: PlanningRole): number => ROLE_RANK[role];
