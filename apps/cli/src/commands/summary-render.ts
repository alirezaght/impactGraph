import { cliImpactSummarySchema } from '@impactgraph/contracts';

import { writeJson, writeLines } from '../output.js';

import type { CommandContext } from '../context.js';
import type { CliImpactSummary } from '@impactgraph/contracts';

// Text rendering of the bounded analyze document (item 9). Ordered by what a reader has to know
// FIRST: can this result be trusted, then what does it say, then what is missing.

const trustBlock = (output: CliImpactSummary): string[] => {
  const lines: string[] = [];
  if (output.analysis.provisional) {
    lines.push('PROVISIONAL ANALYSIS — treat the findings below as indicative only:');
    lines.push(...output.analysis.provisionalReasons.map((reason) => `  ! ${reason}`));
    if (output.freshness.recommendedAction !== undefined) {
      lines.push(`  → ${output.freshness.recommendedAction}`);
    }
    lines.push('');
  }
  return lines;
};

const specificationBlock = (output: CliImpactSummary): string[] => {
  const { specification } = output;
  const quality = specification.extractionQuality;
  const lines = [
    `Specification: ${specification.title} (v${String(specification.version)}, ${specification.extractionMode})`,
    ...(quality === undefined
      ? []
      : [
          `Extraction: ${quality.strategy} — ${String(quality.structuredRequirementCount)} from the specification's own list, ${String(quality.proseRequirementCount)} cut from prose${quality.recognizedSections.length === 0 ? '' : ` (sections: ${quality.recognizedSections.join(', ')})`}`,
        ]),
    `Index: ${output.freshness.state}${output.freshness.stale ? ' (STALE)' : ''}`,
  ];
  const readiness = specification.readiness;
  if (readiness !== undefined) {
    lines.push(`Readiness: ${String(readiness.score)}% — ${readiness.recommendedAction}`);
  } else if (specification.readinessWithheldReason !== undefined) {
    lines.push(`Readiness: withheld — ${specification.readinessWithheldReason}`);
  }
  return [...lines, ''];
};

const countsBlock = (output: CliImpactSummary): string[] => {
  const tiers = Object.entries(output.counts.byLikelihood)
    .map(([tier, count]) => `${tier} ${String(count)}`)
    .join(', ');
  const bases = Object.entries(output.counts.byEvidenceType)
    .map(([basis, count]) => `${basis} ${String(count)}`)
    .join(', ');
  return [
    `Impacts: ${String(output.counts.totalImpacts)} across ${String(output.counts.componentCount)} components`,
    ...(tiers.length === 0 ? [] : [`  by tier: ${tiers}`]),
    ...(bases.length === 0 ? [] : [`  by evidence: ${bases}`]),
    '',
  ];
};

const impactBlock = (output: CliImpactSummary): string[] => {
  if (output.topImpacts.length === 0) {
    return ['No structural impact was found under the current filters.', ''];
  }
  const lines = [
    `Top structural impacts (${String(output.pagination.returned)} of ${String(output.pagination.totalMatching)} matching):`,
  ];
  for (const impact of output.topImpacts) {
    const labels =
      impact.requirementLabels.length > 0 ? ` [${impact.requirementLabels.join(', ')}]` : '';
    // 'confirmation' = the specification itself named this component; 'discovery' = the engine
    // found it. The word travels on every line so an echo can never read as a finding (ADR-0017).
    const provenance = impact.provenanceLabel === undefined ? '' : `, ${impact.provenanceLabel}`;
    lines.push(
      `- ${impact.likelihood.toUpperCase()} ${impact.name}${labels} — ${impact.evidenceType}${provenance}, ${String(impact.hops)} hop(s), conf ${impact.confidence.toFixed(2)}${impact.path === undefined ? '' : ` (${impact.path})`}`,
    );
    if (impact.tierCappedBy !== undefined) {
      lines.push(`    tier capped by evidence: ${impact.tierCappedBy}`);
    }
  }
  if (output.pagination.nextCursor !== undefined) {
    lines.push(
      `  … more available — page with cursor '${output.pagination.nextCursor}' or raise topN`,
    );
  }
  if (output.evidenceIndependence?.statement !== undefined) {
    lines.push(`Evidence independence: ${output.evidenceIndependence.statement}`);
  }
  return [...lines, ''];
};

const gapsBlock = (output: CliImpactSummary): string[] => {
  const lines: string[] = [];
  if (output.unmatchedRequirements.length > 0) {
    lines.push(
      `Requirements with NO structural impact (${String(output.unmatchedRequirements.length)}):`,
    );
    lines.push(
      ...output.unmatchedRequirements.map(
        (requirement) =>
          `- ${requirement.label ?? requirement.id}: ${requirement.statement.slice(0, 120)}`,
      ),
      '',
    );
  }
  if (output.unresolvedConcepts.length > 0) {
    lines.push(
      `Unresolved concepts (${String(output.unresolvedConcepts.length)}) — named in the specification, not found in the index, NOT invented as nodes:`,
    );
    lines.push(...output.unresolvedConcepts.map((entry) => `- ${entry.concept}`), '');
  }
  if (output.predictedArtifacts.length > 0) {
    lines.push('Artifact categories this change is likely to need:');
    lines.push(
      ...output.predictedArtifacts.map(
        (prediction) =>
          `- ${prediction.category} — ${prediction.reason} (see ${prediction.examplePaths.join(', ')})`,
      ),
      '',
    );
  }
  return lines;
};

const warningBlock = (output: CliImpactSummary): string[] => {
  const lines: string[] = [];
  const coverage = output.coverage.indexWarnings;
  if (coverage.totalCount > 0) {
    lines.push(
      `Index warnings: ${String(coverage.totalCount)} total, ${String(coverage.coverageLosingCount)} losing coverage${coverage.affectsPredictedArea ? ' — SOME OVERLAP THE PREDICTED AREA' : ''}`,
    );
    lines.push(
      ...coverage.groups.map(
        (group) =>
          `- ${group.category}: ${String(group.count)}${group.affectsPredictedArea ? ' (in predicted area)' : ''}${group.examplePaths.length === 0 ? '' : ` e.g. ${group.examplePaths[0] ?? ''}`}`,
      ),
      '',
    );
  }
  for (const [title, entries] of [
    ['Non-goal contradictions', output.nonGoalContradictions],
    ['Blocking questions', output.blockingQuestions.map((question) => question.question)],
  ] as const) {
    if (entries.length > 0) {
      lines.push(
        `${title} (${String(entries.length)}):`,
        ...entries.map((entry) => `- ${entry}`),
        '',
      );
    }
  }
  if (output.warnings.length > 0) {
    lines.push(
      `Important warnings (${String(output.warnings.length)}${output.omittedWarningCount > 0 ? `, ${String(output.omittedWarningCount)} routine ones omitted` : ''}):`,
    );
    lines.push(...output.warnings.map((warning) => `- [${warning.code}] ${warning.message}`), '');
  }
  return lines;
};

export const renderImpactSummary = (context: CommandContext, output: CliImpactSummary): void => {
  if (context.format === 'json') {
    writeJson(context, cliImpactSummarySchema, output);
    return;
  }
  writeLines(context, [
    ...trustBlock(output),
    ...specificationBlock(output),
    ...countsBlock(output),
    ...impactBlock(output),
    ...gapsBlock(output),
    ...warningBlock(output),
    `Scope: ${output.impactQuery.scope}`,
    ...output.impactQuery.limitations.map((limitation) => `  - ${limitation}`),
    '',
    'More detail: `impactgraph analyze <spec> --full`, or the list_impacts / export_graph_html tools.',
  ]);
};
