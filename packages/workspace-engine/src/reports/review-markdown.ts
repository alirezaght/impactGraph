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
  unverifiable: 'Unverifiable',
  'accepted-deviation': 'Accepted Deviations',
};

type Finding = CliReviewOutput['findings'][number];

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

export const buildReviewMarkdown = (report: CliReviewOutput): string[] => [
  '# Implementation Review',
  '',
  '## Summary',
  '',
  `Target: ${report.target} · Review snapshot: ${report.reviewSnapshotId}`,
  reviewSummaryLine(report),
  `Overall: ${report.discrepanciesFound ? 'discrepancies found — human judgment required (§43.6)' : 'no discrepancies'}`,
  '',
  '## Approved Specification',
  '',
  `Analysis ${report.analysis.id} · specification ${report.analysis.specificationId} v${String(report.analysis.specificationVersion)} · approved snapshot ${report.analysis.approvedSnapshotId}`,
  ...findingSections(report),
  ...coverageSection(report),
  ...violationSection(report),
  '',
  '## Architectural Edge Changes',
  '',
  `Added: ${report.edgeChanges.added.length > 0 ? report.edgeChanges.added.join(', ') : 'none'}`,
  `Removed: ${report.edgeChanges.removed.length > 0 ? report.edgeChanges.removed.join(', ') : 'none'}`,
];
