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

const textLines = (report: CliReviewOutput): string[] => {
  const lines = [`Review (${report.target}) — ${String(report.changedFiles.length)} changed files`];
  for (const finding of report.findings) {
    lines.push(`  [${finding.category}] ${finding.nodeName}: ${finding.explanation}`);
  }
  for (const violation of report.ruleViolations) {
    lines.push(`  [rule:${violation.ruleId}] ${violation.message}`);
  }
  lines.push('Requirement coverage (estimate):');
  for (const entry of report.coverage) {
    lines.push(`  ${entry.requirementId}: ${entry.status}`);
    for (const evidence of entry.evidence) {
      lines.push(`    ${MARKERS[evidence.marker]} ${evidence.note}`);
    }
  }
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
