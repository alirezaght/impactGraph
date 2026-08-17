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

type DriftEntry = NonNullable<CliReviewOutput['drift']>['entries'][number];

const driftEndpoint = (endpoint: DriftEntry['from']): string => {
  const qualifiers = [endpoint.context, endpoint.repository].filter((value) => value !== undefined);
  return qualifiers.length === 0
    ? endpoint.nodeName
    : `${endpoint.nodeName} (${qualifiers.join(', ')})`;
};

/** Item 7: classified drift — planning-review signal for a human, honest about its bounds. */
const driftLines = (report: CliReviewOutput): string[] => {
  const drift = report.drift;
  if (drift === undefined) {
    return [];
  }
  const lines = ['Architectural drift (classified):'];
  if (drift.entries.length === 0) {
    lines.push('  none among the reported edge changes');
  }
  for (const entry of drift.entries) {
    lines.push(
      `  [${entry.category}] ${driftEndpoint(entry.from)} -> ${driftEndpoint(entry.to)} (${entry.edgeType}, ${entry.direction})`,
    );
  }
  for (const omitted of drift.omitted) {
    lines.push(`  ${String(omitted.count)} more ${omitted.category} entries omitted.`);
  }
  if (drift.unmappedContexts !== undefined && drift.unmappedContexts.contexts.length > 0) {
    lines.push(
      `  Contexts touched outside the approved footprint: ${drift.unmappedContexts.contexts.join(', ')}`,
    );
  }
  return lines;
};

const omittedEdgeLines = (report: CliReviewOutput): string[] => {
  const omitted = (report.edgeChanges.omittedAdded ?? 0) + (report.edgeChanges.omittedRemoved ?? 0);
  return omitted > 0 ? [`  Edge-change lists truncated: ${String(omitted)} edge ids omitted.`] : [];
};

/**
 * ADR-0017/0021: what the approved plan committed to, checked against the diff — forbidden
 * relationships, missing deployment work, guards not updated. Rendered as its own block so a plan
 * violation cannot hide among per-file findings.
 */
const planContractLines = (report: CliReviewOutput): string[] => {
  const contract = report.planContract;
  if (contract === undefined || contract.findings.length === 0) {
    return [];
  }
  const lines = ['Plan contract (approved design vs this diff):'];
  for (const finding of contract.findings) {
    lines.push(`  [${finding.severity}] ${finding.kind}: ${finding.statement}`);
  }
  return lines;
};

/** ADR-0022: the verdict is the first thing on screen, before any finding. */
const verdictLines = (report: CliReviewOutput): string[] => {
  const verdict = report.verdict;
  if (verdict === undefined) {
    return [];
  }
  const counts = verdict.counts;
  return [
    verdict.headline,
    `  matched ${String(counts.matched)} · reused unchanged ${String(counts.reuseConfirmed)} · missing ${String(counts.missing)} · unexpected ${String(counts.unexpected)} · divergent ${String(counts.divergent)} · regression boundaries crossed ${String(counts.guardViolated)} · rule violations ${String(counts.ruleViolations)}`,
    '',
  ];
};

const textLines = (report: CliReviewOutput): string[] => {
  const lines = [
    ...verdictLines(report),
    `Review (${report.target}) — ${String(report.changedFiles.length)} changed files`,
  ];
  for (const finding of report.findings) {
    lines.push(`  [${finding.category}] ${finding.nodeName}: ${finding.explanation}`);
  }
  for (const violation of report.ruleViolations) {
    lines.push(`  [rule:${violation.ruleId}] ${violation.message}`);
  }
  lines.push(...omittedEdgeLines(report));
  lines.push(...planContractLines(report));
  lines.push(...driftLines(report));
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
  /** ADR-0017/0021: the plan-as-contract block, when the pipeline computed one. */
  readonly planContract?: CliReviewOutput['planContract'];
}

export const renderReview = (context: CommandContext, input: RenderReviewInput): void => {
  const report = buildReviewOutput(input.review, input.analysis, input.violations, {
    breakdownContext: input.breakdownContext,
    planContract: input.planContract,
  });
  if (context.format === 'json') {
    writeJson(context, cliReviewOutputSchema, report);
    return;
  }
  writeLines(
    context,
    context.format === 'markdown' ? buildReviewMarkdown(report) : textLines(report),
  );
};
