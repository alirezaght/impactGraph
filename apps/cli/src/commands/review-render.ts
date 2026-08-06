import { cliReviewOutputSchema } from '@impactgraph/contracts';
import { buildReviewMarkdown, buildReviewOutput } from '@impactgraph/workspace-engine';

import { writeJson, writeLines } from '../output.js';

import type { CommandContext } from '../context.js';
import type { RuleViolation } from '@impactgraph/application';
import type { CliReviewOutput } from '@impactgraph/contracts';
import type { ImpactAnalysis, ImplementationReview } from '@impactgraph/domain';
import type { ReviewBreakdownContext } from '@impactgraph/workspace-engine';

// §38.2 report renderers over the versioned review document. Coverage is always worded as an
// estimate, never proof (§25).

const MARKERS = { confirmed: '✓', missing: '✕', unclear: '?' } as const;

/** Item 7: the text report states its own scope, limitations, and confidence — never silently. */
const scopeLines = (report: CliReviewOutput): string[] => {
  const breakdown = report.breakdown;
  if (breakdown === undefined) {
    return [];
  }
  const lines: string[] = [];
  if (breakdown.confidence !== undefined) {
    lines.push(`Confidence: ${breakdown.confidence.level}`);
    lines.push(...breakdown.confidence.reasons.map((reason) => `  - ${reason}`));
  }
  lines.push(
    `Scope: ${String(breakdown.scope.changedFileCount)} changed files vs ${String(breakdown.scope.indexedComponentCount)} indexed components`,
    'Limitations:',
    ...breakdown.scope.limitations.map((limitation) => `  - ${limitation}`),
  );
  return lines;
};

const omittedEdgeLines = (report: CliReviewOutput): string[] => {
  const omitted = (report.edgeChanges.omittedAdded ?? 0) + (report.edgeChanges.omittedRemoved ?? 0);
  return omitted > 0 ? [`  Edge-change lists truncated: ${String(omitted)} edge ids omitted.`] : [];
};

const textLines = (report: CliReviewOutput): string[] => {
  const lines = [`Review (${report.target}) — ${String(report.changedFiles.length)} changed files`];
  for (const finding of report.findings) {
    lines.push(`  [${finding.category}] ${finding.nodeName}: ${finding.explanation}`);
  }
  for (const violation of report.ruleViolations) {
    lines.push(`  [rule:${violation.ruleId}] ${violation.message}`);
  }
  lines.push(...omittedEdgeLines(report));
  lines.push('Requirement coverage (estimate):');
  for (const entry of report.coverage) {
    lines.push(`  ${entry.requirementId}: ${entry.status}`);
    for (const evidence of entry.evidence) {
      lines.push(`    ${MARKERS[evidence.marker]} ${evidence.note}`);
    }
  }
  lines.push(...scopeLines(report));
  return lines;
};

export interface RenderReviewInput {
  readonly review: ImplementationReview;
  readonly analysis: ImpactAnalysis;
  readonly violations: readonly RuleViolation[];
  /** Item 13: present when the caller ran the pipeline and can supply the breakdown inputs. */
  readonly breakdownContext?: ReviewBreakdownContext;
}

export const renderReview = (context: CommandContext, input: RenderReviewInput): void => {
  const report = buildReviewOutput(
    input.review,
    input.analysis,
    input.violations,
    input.breakdownContext,
  );
  if (context.format === 'json') {
    writeJson(context, cliReviewOutputSchema, report);
    return;
  }
  writeLines(
    context,
    context.format === 'markdown' ? buildReviewMarkdown(report) : textLines(report),
  );
};
