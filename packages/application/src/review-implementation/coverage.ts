import type {
  CoverageEvidence,
  CoverageStatus,
  RequirementCoverage,
  ReviewFinding,
  Specification,
} from '@impactgraph/domain';

// Story 11.3 — requirement coverage (PRD §25): an ESTIMATE mapped from review findings,
// never a proof. Every line carries its ✓/✕/? marker so the report shape matches §25.

const statusFor = (
  matched: number,
  missing: number,
  divergent: number,
  unverifiable: number,
): CoverageStatus => {
  const anyProblem = missing + divergent > 0;
  if (matched > 0 && !anyProblem && unverifiable === 0) {
    return 'implemented';
  }
  if (matched > 0) {
    return 'partially-implemented';
  }
  if (missing + divergent > 0) {
    return 'not-found';
  }
  return 'unclear';
};

/** Coverage per requirement, derived from findings — a deterministic projection (PRD §25). */
export const estimateCoverage = (
  specification: Specification,
  findings: readonly ReviewFinding[],
): RequirementCoverage[] =>
  specification.requirements
    .filter((requirement) => requirement.status !== 'rejected')
    .map((requirement) => {
      const related = findings.filter((finding) => finding.requirementId === requirement.id);
      const evidence: CoverageEvidence[] = related.map((finding) => {
        if (finding.category === 'matched') {
          return { marker: 'confirmed', note: `${finding.nodeName} changed as predicted` };
        }
        // ADR-0022: planned reuse satisfies the requirement. The requirement asked for behaviour,
        // and behaviour delivered by untouched existing code is delivered.
        if (finding.category === 'reuse-confirmed') {
          return { marker: 'confirmed', note: finding.explanation };
        }
        // A crossed regression boundary is the requirement being broken, not merely unverified:
        // the specification asked for no change here and got one.
        if (
          finding.category === 'missing' ||
          finding.category === 'divergent' ||
          finding.category === 'guard-violated'
        ) {
          return { marker: 'missing', note: finding.explanation };
        }
        return { marker: 'unclear', note: finding.explanation };
      });
      const count = (category: string): number =>
        related.filter((finding) => finding.category === category).length;
      if (related.length === 0) {
        evidence.push({
          marker: 'unclear',
          note: 'no predicted impacts produced review findings for this requirement',
        });
      }
      return {
        requirementId: requirement.id,
        statement: requirement.statement,
        status:
          related.length === 0
            ? 'unclear'
            : statusFor(
                // A protected surface the diff left alone SATISFIES its requirement — that is the
                // verification value of stating a regression boundary in the first place.
                count('matched') + count('reuse-confirmed'),
                count('missing'),
                count('divergent') + count('guard-violated'),
                count('unverifiable'),
              ),
        evidence,
      };
    });
