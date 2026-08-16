import { createPreflightFinding } from '@impactgraph/domain';

import { matchesAnyGlob } from '../evaluate-rules/glob.js';

import type { ResolvedConcept } from './proposed-edges.js';
import type { PreflightFinding, RepositoryConstraint } from '@impactgraph/domain';

/**
 * Surface accepted architecture decisions that govern the area a plan touches.
 *
 * The rule inside an ADR is prose — nothing here evaluates it, so nothing here can find a
 * violation. What it CAN do is put the decision in front of the reader at planning time, which is
 * when the trials showed it was needed: the decisions existed, and nobody knew which ones applied.
 * One informational finding per decision, listing the requirements that enter its scope.
 */

export interface GuidanceRequirement {
  readonly id: string;
  readonly concepts: readonly ResolvedConcept[];
}

export interface CheckGuidanceInput {
  readonly requirements: readonly GuidanceRequirement[];
  readonly constraints: readonly RepositoryConstraint[];
  readonly nextId: (seed: string) => string;
}

const touchesScope = (
  requirement: GuidanceRequirement,
  constraint: RepositoryConstraint,
): boolean =>
  requirement.concepts.some(
    (concept) =>
      concept.path !== undefined && matchesAnyGlob(concept.path, constraint.scope.pathGlobs),
  );

export const checkGuidance = (input: CheckGuidanceInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  for (const constraint of input.constraints) {
    if (constraint.kind !== 'architecture-guidance') {
      continue;
    }
    const affected = input.requirements
      .filter((requirement) => touchesScope(requirement, constraint))
      .map((requirement) => requirement.id);
    if (affected.length === 0) {
      continue;
    }
    const result = createPreflightFinding({
      id: input.nextId(`guidance:${constraint.id}`),
      kind: 'constraint-warning',
      severity: 'informational',
      requirementIds: affected,
      statement: `${constraint.name} (${constraint.source.filePath}) governs an area this plan touches — its rule is prose and was NOT machine-checked.`,
      recommendation: `Read ${constraint.source.filePath} against the design before implementing; the decision's rule is prose and was NOT machine-checked.`,
      subject: { constraintId: constraint.id, filePaths: [constraint.source.filePath] },
      evidenceIds: [...constraint.evidenceIds],
      confidence: 0.6,
      provenance: constraint.provenance,
      analyzer: 'check-guidance',
    });
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};
