import type { IndexFreshnessDto, IndexWarningReportDto } from '@impactgraph/contracts';
import type { IndexFreshness, IndexWarningReport } from '@impactgraph/domain';

// Domain → contract mapping for the shared index-health blocks (dogfooding item 9). One mapper,
// used by the analyze summary and the status document, so the two surfaces cannot drift apart.

export const toIndexFreshnessDto = (freshness: IndexFreshness): IndexFreshnessDto => ({
  ...freshness,
  reasons: [...freshness.reasons],
});

export const toIndexWarningReportDto = (report: IndexWarningReport): IndexWarningReportDto => ({
  totalCount: report.totalCount,
  coverageLosingCount: report.coverageLosingCount,
  affectsPredictedArea: report.affectsPredictedArea,
  groups: report.groups.map((group) => ({ ...group, examplePaths: [...group.examplePaths] })),
  ...(report.sampled === true ? { sampled: true } : {}),
  ...(report.omittedWarningCount === undefined
    ? {}
    : { omittedWarningCount: report.omittedWarningCount }),
});
