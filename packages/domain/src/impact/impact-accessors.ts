import { provenanceOf } from '../preflight/evidence-provenance.js';

import { derivePlanningRole } from './planning-role.js';

import type { ImpactEvidenceType } from './evidence-basis.js';
import type { ChangeExpectation, RequirementImpact } from './impact-analysis.js';
import type { PlanningRole, PlanningRoleInput, PlanningRoleVerdict } from './planning-role.js';
import type { EvidenceProvenance } from '../preflight/evidence-provenance.js';

/**
 * How to READ an impact record — specifically, what each absent additive field means.
 *
 * Every one of these accessors exists because an additive field arrived after analyses were
 * already stored, and absence had to be given a meaning that could not flatter the record. They
 * live together, away from the entity and its validation, so that meaning is decided in exactly one
 * place: a consumer that reads `impact.evidenceTypes` directly and treats `undefined` as "fine"
 * is the bug these prevent.
 */

/** Absence means the pre-ADR-0022 reading: the surface was expected to change. */
export const changeExpectationOf = (impact: RequirementImpact): ChangeExpectation =>
  impact.changeExpectation ?? 'must-change';

/** True when the plan predicts NO diff at this surface, so an unchanged file is the plan working. */
export const expectsNoChange = (impact: RequirementImpact): boolean =>
  changeExpectationOf(impact) !== 'must-change';

/** Absence is read as the weakest provenance, never as "unclassified but fine". */
export const evidenceProvenanceOf = (impact: RequirementImpact): EvidenceProvenance =>
  provenanceOf(impact.evidenceProvenance);

/**
 * The role a record plays for a planner. Unlike the other additive accessors this RE-DERIVES on
 * absence instead of defaulting: every input the derivation reads is already on the record, so an
 * older artifact gets the same answer a new one would, rather than a placeholder that would push
 * pre-ADR-0025 analyses into the wrong half of every view.
 */
export const planningRoleOf = (impact: RequirementImpact): PlanningRole =>
  planningRoleVerdictOf(impact).role;

/**
 * The role WITH the rule and the sentence behind it. Re-derives whole rather than field by field:
 * a stored role paired with a freshly derived reason could disagree with itself, and the reason is
 * the part a reader argues with.
 */
export const planningRoleVerdictOf = (impact: RequirementImpact): PlanningRoleVerdict => {
  const derived = derivePlanningRole(planningRoleInputOf(impact));
  if (impact.planningRole === undefined || impact.planningRoleRule === undefined) {
    return derived;
  }
  return {
    role: impact.planningRole,
    rule: impact.planningRoleRule,
    reason: impact.planningRoleReason ?? derived.reason,
  };
};

/** The derivation's inputs, read off a stored impact. Shared by the accessor and the assigner. */
export const planningRoleInputOf = (impact: RequirementImpact): PlanningRoleInput => ({
  likelihood: impact.likelihood,
  evidenceTypes: evidenceTypesOf(impact),
  evidenceProvenance: evidenceProvenanceOf(impact),
  impactType: impact.impactType,
  changeExpectation: changeExpectationOf(impact),
  directness: impact.directness,
});

/** Absence is read as the weakest basis, never as "unclassified but fine". */
export const evidenceTypesOf = (impact: RequirementImpact): readonly ImpactEvidenceType[] =>
  impact.evidenceTypes === undefined || impact.evidenceTypes.length === 0
    ? ['lexical-only']
    : impact.evidenceTypes;
