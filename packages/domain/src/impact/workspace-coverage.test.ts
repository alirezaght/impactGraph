import { describe, expect, it } from 'vitest';

import { assessCoverageSufficiency } from './workspace-coverage.js';

const base = {
  requirementCount: 10,
  unmatchedRequirementCount: 0,
  totalConceptCount: 8,
  unresolvedConceptCount: 0,
  missingRepositoryCount: 0,
};

describe('assessCoverageSufficiency', () => {
  it('is adequate when there are no requirements to judge', () => {
    const verdict = assessCoverageSufficiency({
      ...base,
      requirementCount: 0,
      totalConceptCount: 0,
    });
    expect(verdict.status).toBe('adequate');
    expect(verdict.reasons).toEqual([]);
  });

  it('is adequate when requirements and concepts resolve', () => {
    const verdict = assessCoverageSufficiency({ ...base, unmatchedRequirementCount: 2 });
    expect(verdict.status).toBe('adequate');
    expect(verdict.reasons).toEqual([]);
  });

  it('is insufficient when half or more of the requirements match no component', () => {
    const verdict = assessCoverageSufficiency({ ...base, unmatchedRequirementCount: 5 });
    expect(verdict.status).toBe('insufficient-coverage');
    expect(verdict.reasons).toEqual([
      '5 of 10 requirements match no indexed component — the indexed repositories likely do not contain the parts of the system this specification changes.',
    ]);
  });

  it('stays adequate just below the unmatched threshold', () => {
    const verdict = assessCoverageSufficiency({ ...base, unmatchedRequirementCount: 4 });
    expect(verdict.status).toBe('adequate');
  });

  it('is insufficient when no specification concept resolves to any indexed component', () => {
    const verdict = assessCoverageSufficiency({
      ...base,
      unmatchedRequirementCount: 3,
      totalConceptCount: 6,
      unresolvedConceptCount: 6,
    });
    expect(verdict.status).toBe('insufficient-coverage');
    expect(verdict.reasons).toContain(
      'None of the 6 specification concepts resolve to any indexed component — the feature’s central components are not in the index.',
    );
  });

  it('is insufficient when registered repositories are missing while requirements are unmatched', () => {
    const verdict = assessCoverageSufficiency({
      ...base,
      unmatchedRequirementCount: 1,
      missingRepositoryCount: 2,
    });
    expect(verdict.status).toBe('insufficient-coverage');
    expect(verdict.reasons).toEqual([
      '2 registered repositories are not in the index while 1 requirement matches no component — the unmatched work may live in the missing repositories.',
    ]);
  });

  it('stays adequate when repositories are missing but every requirement matched', () => {
    const verdict = assessCoverageSufficiency({ ...base, missingRepositoryCount: 2 });
    expect(verdict.status).toBe('adequate');
  });

  it('collects every applicable reason', () => {
    const verdict = assessCoverageSufficiency({
      requirementCount: 4,
      unmatchedRequirementCount: 4,
      totalConceptCount: 3,
      unresolvedConceptCount: 3,
      missingRepositoryCount: 1,
    });
    expect(verdict.status).toBe('insufficient-coverage');
    expect(verdict.reasons).toHaveLength(3);
  });
});
