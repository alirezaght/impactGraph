/**
 * Repository-coverage sufficiency (deterministic, like §C10 readiness — never model-authored).
 *
 * A readiness score computed over a graph that is missing the feature's repositories looks exactly
 * like one computed over a complete graph, and the reader cannot tell the difference. This verdict
 * is the structural gate: when coverage is fundamentally insufficient, the caller withholds the
 * score and reports the gap instead of a number.
 */

export type WorkspaceCoverageStatus = 'adequate' | 'insufficient-coverage';

export interface CoverageSufficiencyInput {
  readonly requirementCount: number;
  /** Requirements no structural impact points at (lexical-only does not count as covered). */
  readonly unmatchedRequirementCount: number;
  /** Distinct concepts named by the specification's requirements. */
  readonly totalConceptCount: number;
  /** Concepts that resolved to no indexed component. */
  readonly unresolvedConceptCount: number;
  /** Registered, enabled repositories that are absent from disk or from the current index. */
  readonly missingRepositoryCount: number;
}

export interface WorkspaceCoverageVerdict {
  readonly status: WorkspaceCoverageStatus;
  readonly reasons: readonly string[];
}

/** Half the specification unmatched is the point where the analysis stops being an answer. */
const UNMATCHED_RATIO_THRESHOLD = 0.5;

const count = (n: number, singular: string, plural: string): string =>
  `${String(n)} ${n === 1 ? singular : plural}`;

export const assessCoverageSufficiency = (
  input: CoverageSufficiencyInput,
): WorkspaceCoverageVerdict => {
  const reasons: string[] = [];
  if (input.requirementCount === 0) {
    return { status: 'adequate', reasons };
  }
  if (input.unmatchedRequirementCount / input.requirementCount >= UNMATCHED_RATIO_THRESHOLD) {
    reasons.push(
      `${String(input.unmatchedRequirementCount)} of ${String(input.requirementCount)} requirements match no indexed component — the indexed repositories likely do not contain the parts of the system this specification changes.`,
    );
  }
  if (input.totalConceptCount > 0 && input.unresolvedConceptCount >= input.totalConceptCount) {
    reasons.push(
      `None of the ${String(input.totalConceptCount)} specification concepts resolve to any indexed component — the feature’s central components are not in the index.`,
    );
  }
  if (input.missingRepositoryCount > 0 && input.unmatchedRequirementCount > 0) {
    reasons.push(
      `${count(input.missingRepositoryCount, 'registered repository is', 'registered repositories are')} not in the index while ${count(input.unmatchedRequirementCount, 'requirement matches', 'requirements match')} no component — the unmatched work may live in the missing repositories.`,
    );
  }
  return { status: reasons.length === 0 ? 'adequate' : 'insufficient-coverage', reasons };
};
