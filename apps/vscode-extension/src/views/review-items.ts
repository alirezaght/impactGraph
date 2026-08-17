import type { CliReviewOutput } from '@impactgraph/contracts';

// Story 11.4 / §18.7 — pure mapping from the versioned review document to tree data.
// A discrepancy is never automatically a defect (§43.6): the tree presents, humans judge.

export interface ReviewTreeNode {
  readonly kind: 'summary' | 'category' | 'finding' | 'coverage' | 'violation' | 'detail' | 'file';
  readonly label: string;
  readonly description?: string | undefined;
  readonly tooltip?: string | undefined;
  readonly filePath?: string | undefined;
  readonly children: readonly ReviewTreeNode[];
}

const CATEGORY_ORDER = [
  'matched',
  'missing',
  'unexpected',
  'divergent',
  'guard-violated',
  'reuse-confirmed',
  'unverifiable',
  'accepted-deviation',
] as const;

const MARKERS = { confirmed: '✓', missing: '✕', unclear: '?' } as const;

const findingNodes = (report: CliReviewOutput): ReviewTreeNode[] =>
  CATEGORY_ORDER.flatMap((category) => {
    const findings = report.findings.filter((finding) => finding.category === category);
    if (findings.length === 0) {
      return [];
    }
    return [
      {
        kind: 'category' as const,
        label: category,
        description: String(findings.length),
        children: findings.map((finding) => ({
          kind: 'finding' as const,
          label: finding.nodeName,
          description: finding.explanation,
          tooltip: finding.explanation,
          children: finding.filePaths.map((path) => ({
            kind: 'file' as const,
            label: path,
            filePath: path,
            children: [],
          })),
        })),
      },
    ];
  });

const coverageNodes = (report: CliReviewOutput): ReviewTreeNode[] =>
  report.coverage.map((entry) => ({
    kind: 'coverage',
    label: `${entry.requirementId}: ${entry.status}`,
    description: entry.statement,
    tooltip: entry.statement,
    children: entry.evidence.map((line) => ({
      kind: 'detail' as const,
      label: `${MARKERS[line.marker]} ${line.note}`,
      children: [],
    })),
  }));

const violationNodes = (report: CliReviewOutput): ReviewTreeNode[] =>
  report.ruleViolations.map((violation) => ({
    kind: 'violation',
    label: violation.ruleId,
    description: violation.message,
    tooltip: violation.message,
    children: violation.filePaths.map((path) => ({
      kind: 'file' as const,
      label: path,
      filePath: path,
      children: [],
    })),
  }));

/** §18.7 review view: overall status, findings by category, coverage, rule violations. */
export const buildReviewItems = (report: CliReviewOutput): ReviewTreeNode[] => [
  {
    kind: 'summary',
    label: report.discrepanciesFound
      ? 'Discrepancies found — human judgment required'
      : 'No discrepancies',
    description: `${report.target} · ${String(report.changedFiles.length)} changed files · analysis ${report.analysis.id}`,
    children: [],
  },
  ...findingNodes(report),
  {
    kind: 'summary',
    label: 'Requirement coverage (estimate)',
    children: coverageNodes(report),
  },
  ...(report.ruleViolations.length > 0
    ? [
        {
          kind: 'summary' as const,
          label: 'Rule violations',
          description: String(report.ruleViolations.length),
          children: violationNodes(report),
        },
      ]
    : []),
];
