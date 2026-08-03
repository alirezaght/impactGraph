import { cliAnalyzeOutputSchema } from '@impactgraph/contracts';

import { writeJson, writeLines } from '../output.js';

import type { CommandContext } from '../context.js';
import type { CliAnalyzeOutput } from '@impactgraph/contracts';

export { buildAnalyzeOutput } from '@impactgraph/workspace-engine';

const LIKELIHOOD_ORDER = ['required', 'likely', 'possible', 'unlikely'] as const;

const requirementLines = (
  requirement: CliAnalyzeOutput['requirements'][number],
  index: number,
): string[] => {
  const lines = [`Requirement R${String(index + 1)}`, requirement.statement];
  for (const likelihood of LIKELIHOOD_ORDER) {
    const impacts = requirement.impacts.filter((impact) => impact.likelihood === likelihood);
    if (impacts.length > 0) {
      lines.push(`${likelihood.charAt(0).toUpperCase()}${likelihood.slice(1)}:`);
      lines.push(
        ...impacts.map(
          (impact) => `- ${impact.name} (${impact.impactType}, ${String(impact.confidence)})`,
        ),
      );
    }
  }
  if (requirement.openQuestions.length > 0) {
    lines.push('Open questions:');
    lines.push(...requirement.openQuestions.map((question) => `- ${question.question}`));
  }
  const evidence = [...new Set(requirement.impacts.flatMap((impact) => impact.evidenceFiles))];
  if (evidence.length > 0) {
    lines.push('Evidence:');
    lines.push(...evidence.map((file) => `- ${file}`));
  }
  return lines;
};

/**
 * §18.4: proposed relationships get their own section, never mixed into the impact lists above.
 * Every line states that the relationship does NOT exist yet, plus the option that implies it.
 */
const proposedLines = (output: CliAnalyzeOutput): string[] => {
  const structure = output.proposedStructure;
  if (structure === undefined) {
    return [];
  }
  const optionTitle = (id: string): string =>
    output.architecturalOptions?.find((option) => option.id === id)?.title ?? id;
  const nodeLines = structure.nodes.map(
    (node) =>
      `- NEW ${node.type} ${node.name} — proposed by '${optionTitle(node.originOptionId)}' (${node.provenance}, ${String(node.confidence)})`,
  );
  const edgeLines = structure.relationships.map(
    (relationship) =>
      `- PROPOSED ${relationship.sourceId} —${relationship.type}→ ${relationship.targetId} — proposed by '${optionTitle(relationship.originOptionId)}' (${relationship.provenance}, ${String(relationship.confidence)})`,
  );
  if (nodeLines.length === 0 && edgeLines.length === 0) {
    return [];
  }
  return [
    `Proposed structure (${String(nodeLines.length + edgeLines.length)}) — does not exist in the repository today:`,
    ...nodeLines,
    ...edgeLines,
    '',
  ];
};

/** §46 example output shape: per requirement, impacts grouped by likelihood + evidence. */
export const renderAnalyze = (context: CommandContext, output: CliAnalyzeOutput): void => {
  if (context.format === 'json') {
    writeJson(context, cliAnalyzeOutputSchema, output);
    return;
  }
  const readiness = output.specification.readiness;
  const lines: string[] = [
    `Specification: ${output.specification.title} (v${String(output.specification.version)}, ${output.specification.extractionMode})`,
    `Snapshot: ${output.analysis.snapshotId} — ${String(output.analysis.impactCount)} impacts`,
    ...(readiness === undefined
      ? []
      : [
          `Readiness: ${String(readiness.score)}% (blocking: ${String(readiness.blockingQuestions)}, important: ${String(readiness.importantQuestions)}, minor: ${String(readiness.minorQuestions)}) — ${readiness.recommendedAction}`,
        ]),
    '',
  ];
  output.requirements.forEach((requirement, index) => {
    lines.push(...requirementLines(requirement, index), '');
  });
  lines.push(...proposedLines(output));
  if (output.warnings.length > 0) {
    lines.push(`Warnings (${String(output.warnings.length)}):`);
    lines.push(...output.warnings.map((warning) => `- ${warning}`));
  }
  writeLines(context, lines);
};
