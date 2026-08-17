import { REVIEW_CATEGORIES } from '@impactgraph/domain';

import type { CliReviewOutput } from '@impactgraph/contracts';
import type { ReviewCategory } from '@impactgraph/domain';

// §38.2 Markdown report, built from the versioned review document — shared by the CLI
// (`--format markdown`) and the extension's "Open Review Report" command.

const MARKERS = { confirmed: '✓', missing: '✕', unclear: '?' } as const;

const SECTION_TITLES: Record<ReviewCategory, string> = {
  matched: 'Matched',
  missing: 'Missing',
  unexpected: 'Unexpected',
  divergent: 'Divergent',
  'reuse-confirmed': 'Reused Unchanged (by design)',
  'guard-violated': 'Regression Boundary Violated',
  unverifiable: 'Unverifiable',
  'accepted-deviation': 'Accepted Deviations',
};

type Finding = CliReviewOutput['findings'][number];

/** The baseline was never approved: every "approved" wording must say "baseline" instead. */
const isProvisional = (report: CliReviewOutput): boolean =>
  report.baseline?.authority === 'unapproved-prediction';

/** §24.1: findings whose discrepancy a human accepted (marked, never recategorized). */
const acceptedFindings = (report: CliReviewOutput): Finding[] =>
  report.findings.filter((finding) => finding.acceptedDeviation !== undefined);

const countFor = (report: CliReviewOutput, category: ReviewCategory): number =>
  report.findings.filter((f) => f.category === category).length +
  (category === 'accepted-deviation' ? acceptedFindings(report).length : 0);

export const reviewSummaryLine = (report: CliReviewOutput): string =>
  REVIEW_CATEGORIES.map(
    (category) => `${SECTION_TITLES[category]}: ${String(countFor(report, category))}`,
  ).join('  ');

const findingLine = (finding: Finding): string =>
  `- **${finding.nodeName}** — ${finding.explanation}${
    finding.acceptedDeviation === undefined
      ? ''
      : ` _(accepted deviation: ${finding.acceptedDeviation.reason})_`
  }`;

/** §38.2 accepted-deviations content: each accepted finding with its recorded reason. */
const acceptedDeviationLines = (report: CliReviewOutput): string[] =>
  acceptedFindings(report).map(
    (finding) =>
      `- **${finding.nodeName}** — accepted (${finding.category}): ${finding.acceptedDeviation?.reason ?? ''}`,
  );

const findingSections = (report: CliReviewOutput): string[] => {
  const lines: string[] = [];
  for (const category of REVIEW_CATEGORIES) {
    const findings = report.findings.filter((finding) => finding.category === category);
    const entries =
      category === 'accepted-deviation'
        ? [...findings.map(findingLine), ...acceptedDeviationLines(report)]
        : findings.map(findingLine);
    lines.push('', `## ${SECTION_TITLES[category]}`, '');
    lines.push(...(entries.length === 0 ? ['_none_'] : entries));
  }
  return lines;
};

const coverageSection = (report: CliReviewOutput): string[] => {
  const lines = ['', '## Requirement Coverage (estimate — not proof, §25)'];
  for (const entry of report.coverage) {
    lines.push('', `### ${entry.requirementId} — ${entry.status}`, '', `> ${entry.statement}`, '');
    for (const evidence of entry.evidence) {
      lines.push(`- ${MARKERS[evidence.marker]} ${evidence.note}`);
    }
  }
  return lines;
};

const violationSection = (report: CliReviewOutput): string[] => {
  const lines = ['', '## Rule Violations'];
  if (report.ruleViolations.length === 0) {
    lines.push('', '_none_');
  }
  for (const violation of report.ruleViolations) {
    lines.push('', `- **${violation.ruleId}** — ${violation.message}`);
    for (const path of violation.filePaths) {
      lines.push(`  - evidence: ${path}`);
    }
  }
  return lines;
};

/** Item 7: the report explains its own scope, limitations, and confidence — measured, not assumed. */
const scopeSection = (report: CliReviewOutput): string[] => {
  const breakdown = report.breakdown;
  if (breakdown === undefined) {
    return [];
  }
  const { scope, confidence } = breakdown;
  const snapshotWording = isProvisional(report) ? 'baseline snapshot' : 'approved snapshot';
  return [
    '',
    '## Scope and Confidence',
    '',
    `Compared ${String(scope.changedFileCount)} changed files against ${String(scope.indexedComponentCount)} indexed components (${snapshotWording} ${scope.approvedSnapshotId} → review snapshot ${scope.reviewSnapshotId}).`,
    ...(confidence === undefined
      ? []
      : ['', `Confidence: **${confidence.level}**`, ...confidence.reasons.map((r) => `- ${r}`)]),
    '',
    'Limitations:',
    ...scope.limitations.map((limitation) => `- ${limitation}`),
  ];
};

type DriftEntry = NonNullable<CliReviewOutput['drift']>['entries'][number];

const driftEndpoint = (endpoint: DriftEntry['from']): string =>
  endpoint.context === undefined ? endpoint.nodeName : `${endpoint.nodeName} [${endpoint.context}]`;

const driftLine = (entry: DriftEntry): string => {
  const repositories =
    entry.from.repository !== undefined &&
    entry.to.repository !== undefined &&
    entry.from.repository !== entry.to.repository
      ? ` — ${entry.from.repository} → ${entry.to.repository}`
      : '';
  return `- **${entry.category}** — ${driftEndpoint(entry.from)} → ${driftEndpoint(entry.to)} (${entry.edgeType}, ${entry.direction})${repositories}`;
};

/** Item 7: classified drift — a planning-review signal for a human, never a verdict (§43.6). */
const driftSection = (report: CliReviewOutput): string[] => {
  const drift = report.drift;
  if (drift === undefined) {
    return [];
  }
  const lines = ['', '## Architectural Drift (classified — for human judgment, not a verdict)', ''];
  lines.push(...(drift.entries.length === 0 ? ['_none among the reported edge changes_'] : drift.entries.map(driftLine)));
  lines.push(
    ...drift.omitted.map(
      (entry) => `- _${String(entry.count)} more ${entry.category} entries omitted by the report cap_`,
    ),
  );
  if (drift.unmappedContexts !== undefined) {
    const { contexts, omitted } = drift.unmappedContexts;
    lines.push(
      '',
      contexts.length === 0
        ? 'Every context touched by the diff is inside the approved footprint.'
        : `Contexts touched outside the approved footprint: ${contexts.join(', ')}${
            omitted === undefined ? '' : ` (${String(omitted)} more omitted)`
          }`,
    );
  }
  return lines;
};

const edgeList = (ids: readonly string[], omitted: number | undefined): string => {
  const listed = ids.length > 0 ? ids.join(', ') : 'none';
  return omitted === undefined || omitted === 0
    ? listed
    : `${listed} (${String(omitted)} more omitted)`;
};

/** §38.2 baseline heading: an unapproved baseline is named for what it is, never dressed up. */
const baselineSection = (report: CliReviewOutput): string[] => [
  '',
  isProvisional(report) ? '## Baseline Specification (unapproved draft)' : '## Approved Specification',
  '',
  `Analysis ${report.analysis.id} · specification ${report.analysis.specificationId} v${String(report.analysis.specificationVersion)} · ${isProvisional(report) ? 'baseline' : 'approved'} snapshot ${report.analysis.approvedSnapshotId}`,
];

export const buildReviewMarkdown = (report: CliReviewOutput): string[] => [
  '# Implementation Review',
  '',
  '## Summary',
  '',
  `Target: ${report.target} · Review snapshot: ${report.reviewSnapshotId}`,
  reviewSummaryLine(report),
  `Overall: ${report.discrepanciesFound ? 'discrepancies found — human judgment required (§43.6)' : 'no discrepancies'}`,
  ...baselineSection(report),
  ...findingSections(report),
  ...coverageSection(report),
  ...violationSection(report),
  '',
  '## Architectural Edge Changes',
  '',
  `Added: ${edgeList(report.edgeChanges.added, report.edgeChanges.omittedAdded)}`,
  `Removed: ${edgeList(report.edgeChanges.removed, report.edgeChanges.omittedRemoved)}`,
  ...driftSection(report),
  ...scopeSection(report),
];
