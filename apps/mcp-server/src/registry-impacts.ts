import {
  assessWorkspaceFreshness,
  buildAnalysisForSpecification,
  buildImpactPage,
  buildImpactSummary,
  collectWorkspaceRepositoryContext,
  createWorkspaceAiServices,
  ensureRegisteredRepositoriesIndexed,
  lastRunWarningInputs,
  latestAnalysis,
  loadAnalysis,
  loadGraphForSnapshot,
  loadSpecification,
  recordActualImpact,
  runPreflightForAnalysis,
  buildWorkspaceCoverage,
  unindexedRegisteredRepositories,
} from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';
import type { PreflightContext, WorkspaceRepositoryContext } from '@impactgraph/workspace-engine';

/**
 * The impact-analysis tools (items 9 and 10 of the trial follow-up).
 *
 * `analyze_impact` returns a BOUNDED summary: status, extraction quality, index freshness, coverage,
 * counts, the strongest structural findings, and the gaps. It used to return every impact of every
 * requirement with full dependency paths, which on a real repository is hundreds of kilobytes — an
 * agent could not read it, so the tool's answer was unusable as an answer. The detail did not go
 * away; it moved to `list_impacts`, which pages.
 */

/**
 * The coverage verdict and the adversarial pass, fed from the SAME WorkspaceRepositoryContext.
 * Coverage is computed first, because every downstream judgement — "this is new surface", "this
 * symbol does not exist" — is unfounded over code that was never searched. The missing-repository
 * names are a roster FACT from that context — never "every unmatched requirement", which once made
 * a fully indexed workspace report unindexed repositories that its own workspaceCoverage block
 * said did not exist.
 */
const runCoveragePreflight = (
  context: Omit<PreflightContext, 'coverageInsufficient' | 'missingRepositoryNames'>,
  workspace: WorkspaceRepositoryContext,
) => {
  const coverage = buildWorkspaceCoverage({
    specification: context.specification,
    analysis: context.analysis,
    context: workspace,
    graph: context.graph,
  });
  return runPreflightForAnalysis({
    ...context,
    coverageInsufficient: coverage.status === 'insufficient-coverage',
    missingRepositoryNames: unindexedRegisteredRepositories(workspace).map((state) => state.name),
  });
};

const analyzeImpact: ToolHandler<'analyze_impact'> = async (rootDir, input) => {
  const { specificationId, ...filters } = input;
  const spec = await loadSpecification(rootDir, specificationId);
  if (!spec.ok) {
    return spec;
  }
  const ai = createWorkspaceAiServices(rootDir, { apiKey: process.env['IMPACTGRAPH_API_KEY'] });
  if (!ai.ok) {
    return ai;
  }
  // Coverage validation BEFORE analysis: registered repositories missing from the current index
  // are indexed automatically (registered = user-confirmed); a failed reindex is not fatal —
  // the summary's workspaceCoverage and requiredActions report the remaining gap.
  const ensured = await ensureRegisteredRepositoriesIndexed(rootDir);
  if (!ensured.ok) {
    return ensured;
  }
  const built = await buildAnalysisForSpecification(rootDir, spec.value, {
    classifier: ai.value.classifier,
    interpreter: ai.value.interpreter,
  });
  if (!built.ok) {
    return built;
  }
  const workspace = await collectWorkspaceRepositoryContext(rootDir);
  if (!workspace.ok) {
    return workspace;
  }
  // The adversarial pass runs here, unconditionally. Making it a separate tool would recreate the
  // failure this whole change exists to fix: the questions were always answerable, and nobody knew
  // to ask them (ADR-0017).
  const preflight = runCoveragePreflight(
    {
      rootDir,
      specification: spec.value,
      specificationText: spec.value.rawText,
      analysis: built.value.analysis,
      graph: built.value.graph,
      snapshotId: built.value.snapshotId,
    },
    workspace.value,
  );
  return {
    ok: true,
    value: buildImpactSummary({
      specification: spec.value,
      analysis: preflight.analysis,
      graph: built.value.graph,
      workspace: workspace.value,
      preflight,
      // Freshness is compared at ANSWER time, not index time: the tree can move between the two,
      // and a conclusion drawn from a stale index has to say so (item 10).
      freshness: await assessWorkspaceFreshness({
        rootDir,
        snapshotId: built.value.snapshotId,
        specificationId: spec.value.id,
        specificationVersion: spec.value.version,
      }),
      extractionMode: 'unchanged',
      // The persisted warning lines are a capped sample; the true count travels with them so the
      // report never silently maxes out near the cap (item 9, GAP 3).
      ...(await lastRunWarningInputs(rootDir)),
      filters,
    }),
  };
};

/**
 * The detail page. Defaults to the most recent analysis so the follow-up after `analyze_impact`
 * needs no id, and renders against the analysis's OWN snapshot — rendering a stored analysis
 * against the current graph would silently drop components that have since moved.
 */
const listImpacts: ToolHandler<'list_impacts'> = async (rootDir, input) => {
  const { analysisId, ...filters } = input;
  const loaded =
    analysisId === undefined
      ? await latestAnalysis(rootDir)
      : await loadAnalysis(rootDir, analysisId);
  if (!loaded.ok) {
    return loaded;
  }
  const spec = await loadSpecification(
    rootDir,
    loaded.value.specificationId,
    loaded.value.specificationVersion,
  );
  if (!spec.ok) {
    return spec;
  }
  const graph = await loadGraphForSnapshot(rootDir, loaded.value.repositorySnapshotId);
  if (!graph.ok) {
    return graph;
  }
  return {
    ok: true,
    value: buildImpactPage({
      specification: spec.value,
      analysis: loaded.value,
      graph: graph.value,
      filters,
    }),
  };
};

/**
 * Item 12. The response always carries the note about what a measured outcome IS: evidence for a
 * human to review. ImpactGraph does not retrain, re-rank, or rewrite confirmed knowledge from one
 * result, and a caller reading a precision figure has to know that.
 */
const EVIDENCE_NOTE =
  'Recorded as append-only evidence. The analysis was not modified, no confirmed repository ' +
  'knowledge was changed, and no ranking rule was learned from this single result — the metrics ' +
  'are material for a human review of accuracy over time.';

const recordActual: ToolHandler<'record_actual_impact'> = async (rootDir, input) => {
  const recorded = await recordActualImpact({ rootDir, ...input });
  if (!recorded.ok) {
    return recorded;
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      command: 'record-actual-impact',
      outcomeId: recorded.value.actual.id,
      analysisId: recorded.value.actual.analysisId,
      recordedAt: recorded.value.actual.recordedAt,
      metrics: {
        ...recorded.value.metrics,
        truePositives: [...recorded.value.metrics.truePositives],
        falsePositives: [...recorded.value.metrics.falsePositives],
        falseNegatives: [...recorded.value.metrics.falseNegatives],
        missedArtifactCategories: [...recorded.value.metrics.missedArtifactCategories],
        missedRelationshipTypes: [...recorded.value.metrics.missedRelationshipTypes],
        judgedTiers: [...recorded.value.metrics.judgedTiers],
        falsePositiveBases: [...recorded.value.metrics.falsePositiveBases],
      },
      historyCount: recorded.value.historyCount,
      // Item 8: every recording answers "how is prediction quality trending" — derived from all
      // stored outcomes at answer time, never persisted. Absent only if listing them failed.
      ...(recorded.value.aggregate === undefined ? {} : { aggregate: recorded.value.aggregate }),
      note: EVIDENCE_NOTE,
    },
  };
};

export const IMPACT_HANDLERS = {
  analyze_impact: analyzeImpact,
  list_impacts: listImpacts,
  record_actual_impact: recordActual,
} as const;
