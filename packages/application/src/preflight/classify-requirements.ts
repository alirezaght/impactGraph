import { createPreflightFinding } from '@impactgraph/domain';

import type {
  PreflightFinding,
  RequirementClassification,
  UnmatchedRequirementClass,
} from '@impactgraph/domain';

/**
 * Turn an unmatched-requirement classification into a finding a planner can act on.
 *
 * "22 of 23 requirements match no indexed component" is the shape of the answer that made the
 * trials useless: it reads as one problem when it is six, and the six call for opposite decisions.
 * Splitting them is the whole value — `NEW_SURFACE` means build it, `COVERAGE_GAP` means stop and
 * index, `INVALID_ASSUMPTION` means the specification is wrong.
 */

/** The observations a caller must supply. Deterministic, all read from the analysis. */
export interface RequirementSignalInput {
  readonly hasInvalidSymbolAssumption: boolean;
  readonly touchesUnindexedRepository: boolean;
  readonly touchesIndexingGap: boolean;
  readonly usesCreationLanguage: boolean;
  readonly referencesExternalBoundary: boolean;
  readonly hasAmbiguousConcept: boolean;
  readonly siblingSurfaceIndexed: boolean;
}

const FINDING_KIND: Readonly<
  Record<UnmatchedRequirementClass, PreflightFinding['kind']>
> = {
  NEW_SURFACE: 'new-surface',
  COVERAGE_GAP: 'coverage-gap',
  INVALID_ASSUMPTION: 'invalid-assumption',
  AMBIGUOUS: 'unresolved-architectural-question',
  NO_EVIDENCE: 'coverage-gap',
  EXTERNAL_DEPENDENCY: 'coverage-gap',
};

const RECOMMENDATION: Readonly<Record<UnmatchedRequirementClass, string>> = {
  NEW_SURFACE: 'Plan this as new construction — there is nothing existing to change.',
  COVERAGE_GAP:
    'Register and index the missing repository or directory before deciding anything about this requirement.',
  INVALID_ASSUMPTION:
    'Correct the specification, or add the thing it assumes as an explicit part of this change.',
  AMBIGUOUS: 'Pick one reading and say so — the readings touch different components.',
  NO_EVIDENCE:
    'Name the intended components, or accept that the analysis says nothing about this requirement.',
  EXTERNAL_DEPENDENCY:
    'Confirm the external system’s contract by hand; this repository cannot validate it.',
};

/**
 * Every classification produces a finding, including NEW_SURFACE — which is informational, not a
 * defect. That distinction is carried by severity, so a plan full of legitimate new construction
 * never reads as a plan full of problems.
 */
const severityOf = (classification: UnmatchedRequirementClass): PreflightFinding['severity'] => {
  if (classification === 'INVALID_ASSUMPTION') {
    return 'blocking';
  }
  return classification === 'NEW_SURFACE' ? 'informational' : 'warning';
};

export interface ClassifyRequirementsInput {
  readonly requirements: readonly { readonly id: string; readonly statement: string }[];
  readonly classifications: readonly RequirementClassification[];
  readonly nextId: (seed: string) => string;
}

export const classifyRequirements = (
  input: ClassifyRequirementsInput,
): readonly PreflightFinding[] => {
  const statementById = new Map(
    input.requirements.map((requirement) => [requirement.id, requirement.statement]),
  );
  const findings: PreflightFinding[] = [];
  for (const classification of input.classifications) {
    const severity = severityOf(classification.classification);
    const statement = statementById.get(classification.requirementId) ?? '';
    const result = createPreflightFinding({
      id: input.nextId(`class:${classification.requirementId}`),
      kind: FINDING_KIND[classification.classification],
      // A blocking invalid assumption raised here would carry no evidence — the assumption
      // analyzer owns that finding and cites the container it read. Here it can only warn.
      severity: severity === 'blocking' ? 'warning' : severity,
      requirementIds: [classification.requirementId],
      statement: `${classification.requirementId} — ${classification.classification}: ${classification.rationale}.${statement === '' ? '' : ` Requirement: ${statement.slice(0, 160)}`}`,
      recommendation: RECOMMENDATION[classification.classification],
      subject: {},
      evidenceIds: [],
      confidence: classification.confidence,
      provenance: 'static-analysis',
      analyzer: 'classify-requirements',
    });
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};
