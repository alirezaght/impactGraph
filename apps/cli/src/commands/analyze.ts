import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isWorkspaceInitialized } from '@impactgraph/persistence';
import {
  applicationsForGraph,
  buildAnalysisForSpecification,
  contextsForGraph,
  createWorkspaceAiServices,
  submitSpecification,
} from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';

import { buildAnalyzeOutput, renderAnalyze } from './analyze-render.js';

import type { CommandContext, CommandResult } from '../context.js';

// Story 4.3 / PRD §46 — `impactgraph analyze spec.md`: specification → indexed graph →
// evidence-backed impact list, via the shared workspace engine.

export const runAnalyze = async (context: CommandContext): Promise<CommandResult> => {
  const specPath = context.args[0];
  if (specPath === undefined) {
    return failed({
      category: 'configurationError',
      message: 'usage: impactgraph analyze <specification.md>',
    });
  }
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  const absoluteSpecPath = resolve(context.rootDir, specPath);
  if (!existsSync(absoluteSpecPath)) {
    return failed({
      category: 'configurationError',
      message: `specification file not found: ${specPath}`,
    });
  }
  // Provider key from the environment only (§35); headless runs have no preview hook —
  // the send is still mode-guarded, redacted, and audited (docs/workflows).
  const ai = createWorkspaceAiServices(context.rootDir, {
    apiKey: process.env['IMPACTGRAPH_API_KEY'],
  });
  if (!ai.ok) {
    return failed(ai.error);
  }
  const submitted = await submitSpecification({
    rootDir: context.rootDir,
    specName: specPath,
    rawText: readFileSync(absoluteSpecPath, 'utf8'),
    sourceReference: specPath,
    extractor: ai.value.extractor,
  });
  if (!submitted.ok) {
    return failed(submitted.error);
  }
  const built = await buildAnalysisForSpecification(
    context.rootDir,
    submitted.value.specification,
    { classifier: ai.value.classifier, interpreter: ai.value.interpreter },
  );
  if (!built.ok) {
    return failed(built.error);
  }
  renderAnalyze(
    context,
    buildAnalyzeOutput({
      specification: submitted.value.specification,
      analysis: built.value.analysis,
      graph: built.value.graph,
      evidenceFileById: built.value.evidenceFileById,
      extractionMode: submitted.value.extractionMode,
      contextByNodeId: contextsForGraph(context.rootDir, built.value.graph),
      applicationByNodeId: applicationsForGraph(built.value.graph),
    }),
  );
  return succeeded(built.value.analysis.warnings.length > 0);
};
