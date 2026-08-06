import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isWorkspaceInitialized } from '@impactgraph/persistence';
import {
  applicationsForGraph,
  assessWorkspaceFreshness,
  buildAnalysisForSpecification,
  buildImpactSummary,
  collectWorkspaceRepositoryContext,
  contextsForGraph,
  createWorkspaceAiServices,
  ensureRegisteredRepositoriesIndexed,
  lastRunIgnoredCount,
  lastRunWarningRecords,
  submitSpecification,
} from '@impactgraph/workspace-engine';

import { failed, succeeded } from '../context.js';

import { buildAnalyzeOutput, renderAnalyze } from './analyze-render.js';
import { renderImpactSummary } from './summary-render.js';

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
  // Coverage validation before analysis: registered repositories missing from the current
  // index are indexed automatically; the summary reports whatever gap remains.
  const ensured = await ensureRegisteredRepositoriesIndexed(context.rootDir);
  if (!ensured.ok) {
    return failed(ensured.error);
  }
  const built = await buildAnalysisForSpecification(
    context.rootDir,
    submitted.value.specification,
    { classifier: ai.value.classifier, interpreter: ai.value.interpreter },
  );
  if (!built.ok) {
    return failed(built.error);
  }
  await render(context, submitted.value, built.value);
  return succeeded(built.value.analysis.warnings.length > 0);
};

type Submitted = Awaited<ReturnType<typeof submitSpecification>> & { ok: true };
type Built = Awaited<ReturnType<typeof buildAnalysisForSpecification>> & { ok: true };

/**
 * The DEFAULT is the bounded summary (item 9). The full document stays one flag away, but it is no
 * longer what a caller gets by accident — on a real repository it exceeded agent context limits.
 */
const render = async (
  context: CommandContext,
  submitted: Submitted['value'],
  built: Built['value'],
): Promise<void> => {
  if (context.full === true) {
    renderAnalyze(
      context,
      buildAnalyzeOutput({
        specification: submitted.specification,
        analysis: built.analysis,
        graph: built.graph,
        evidenceFileById: built.evidenceFileById,
        extractionMode: submitted.extractionMode,
        contextByNodeId: contextsForGraph(context.rootDir, built.graph),
        applicationByNodeId: applicationsForGraph(built.graph),
      }),
    );
    return;
  }
  const ignoredFileCount = await lastRunIgnoredCount(context.rootDir);
  const workspace = await collectWorkspaceRepositoryContext(context.rootDir);
  renderImpactSummary(
    context,
    buildImpactSummary({
      specification: submitted.specification,
      analysis: built.analysis,
      graph: built.graph,
      ...(workspace.ok ? { workspace: workspace.value } : {}),
      freshness: await assessWorkspaceFreshness({
        rootDir: context.rootDir,
        snapshotId: built.snapshotId,
        specificationId: submitted.specification.id,
        specificationVersion: submitted.specification.version,
      }),
      extractionMode: submitted.extractionMode,
      indexWarnings: await lastRunWarningRecords(context.rootDir),
      ...(ignoredFileCount === undefined ? {} : { ignoredFileCount }),
      ...(context.impactFilters === undefined ? {} : { filters: context.impactFilters }),
    }),
  );
};
