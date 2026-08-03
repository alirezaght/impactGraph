import { cliSelectOptionOutputSchema } from '@impactgraph/contracts';
import { isWorkspaceInitialized } from '@impactgraph/persistence';
import { selectArchitecturalOption } from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';
import { writeJson, writeLines } from '../output.js';

import type { CommandContext, CommandResult } from '../context.js';

// Story 6.6/15.4 — `impactgraph select-option <analysisId> <optionId> [modifiedDescription]`:
// the USER selects a §C8/§26 AI-assisted option; the selection lands as a human-confirmed
// ArchitecturalDecision on specification version N+1. The analysis is never modified.

export const runSelectOption = async (context: CommandContext): Promise<CommandResult> => {
  const [analysisId, optionId, modifiedDescription] = context.args;
  if (analysisId === undefined || optionId === undefined) {
    return failed({
      category: 'configurationError',
      message: 'usage: impactgraph select-option <analysisId> <optionId> [modifiedDescription]',
    });
  }
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  const selected = await selectArchitecturalOption({
    rootDir: context.rootDir,
    analysisId,
    optionId,
    modifiedDescription,
  });
  if (!selected.ok) {
    return failed(selected.error);
  }
  const { specification, decisionId, option, answeredQuestionId } = selected.value;
  if (context.format === 'json') {
    writeJson(context, cliSelectOptionOutputSchema, {
      schemaVersion: 1,
      command: 'select-option',
      analysisId,
      optionId,
      specificationId: specification.id,
      specificationVersion: specification.version,
      decisionId,
      ...(answeredQuestionId === undefined ? {} : { answeredQuestionId }),
    });
  } else {
    writeLines(context, [
      `selected option '${option.title}' (${option.id}) from analysis ${analysisId}`,
      `recorded decision ${decisionId} on specification ${specification.id} v${String(specification.version)}`,
      ...(answeredQuestionId === undefined
        ? []
        : [`resolved open question ${answeredQuestionId} (§C8)`]),
    ]);
  }
  return succeeded();
};
