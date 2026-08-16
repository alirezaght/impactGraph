import { analogousSqlLiterals } from './analogous-sql.js';
import { buildPreflightArtifact, savePreflightArtifact } from './preflight-artifacts.js';
import { configPreflightInputs } from './preflight-config.js';
import { runPreflightForAnalysis } from './preflight.js';
import {
  buildWorkspaceCoverage,
  unindexedRegisteredRepositories,
} from './reports/workspace-coverage-block.js';
import { collectTestEnvironments } from './test-environments.js';

import type { Failable } from './failure.js';
import type { PreflightContext, PreflightOutcome } from './preflight.js';
import type { WorkspaceRepositoryContext } from './repository-coverage.js';

/**
 * The coverage verdict and the adversarial pass, fed from the SAME WorkspaceRepositoryContext.
 *
 * Coverage is computed first, because every downstream judgement — "this is new surface", "this
 * symbol does not exist" — is unfounded over code that was never searched. The missing-repository
 * names are a roster FACT from that context — never "every unmatched requirement", which once made
 * a fully indexed workspace report unindexed repositories that its own workspaceCoverage block
 * said did not exist.
 *
 * Lives in the engine so both shells (MCP `analyze_impact` and `impactgraph analyze`) run the
 * identical pass — apps stay composition roots, and the CLI can never fall behind the server.
 */

export type CoveragePreflightContext = Omit<
  PreflightContext,
  | 'coverageInsufficient'
  | 'missingRepositoryNames'
  | 'analogousLiterals'
  | 'configRequirements'
  | 'configDeclarations'
  | 'testEnvironments'
>;

export const runCoveragePreflight = async (
  context: CoveragePreflightContext,
  workspace: WorkspaceRepositoryContext,
): Promise<Failable<PreflightOutcome>> => {
  const coverage = buildWorkspaceCoverage({
    specification: context.specification,
    analysis: context.analysis,
    context: workspace,
    graph: context.graph,
  });
  // ADR-0020 §4 — computed HERE, once, because the type-comparison analyzer lives in
  // packages/application, which must not reach into the fragment cache. Loaded only when the
  // specification's text actually contains SQL comparisons (analogousSqlLiterals short-circuits).
  const analogousLiterals = await analogousSqlLiterals(
    context.rootDir,
    context.snapshotId,
    context.specificationText,
  );
  // The runtime and config-semantics analyzers receive what the PLAN needs (hop-zero config
  // matches) and how the repository declares it — computed here because it reads files and the
  // fragment cache, which the sync engine pass must not.
  const config = await configPreflightInputs(context.rootDir, context.graph, context.analysis);
  const outcome = runPreflightForAnalysis({
    ...context,
    analogousLiterals,
    testEnvironments: collectTestEnvironments(context.rootDir, context.graph),
    configRequirements: config.requirements,
    configDeclarations: config.declarations,
    coverageInsufficient: coverage.status === 'insufficient-coverage',
    missingRepositoryNames: unindexedRegisteredRepositories(workspace).map((state) => state.name),
  });
  // Frozen alongside the draft analysis (spec R18): approval later freezes the analysis, and this
  // artifact is what lets review and `list_preflight_findings` read the approval-time adversarial
  // knowledge instead of re-deriving a weaker version.
  const persisted = savePreflightArtifact(
    context.rootDir,
    buildPreflightArtifact({
      outcome,
      analysis: context.analysis,
      specification: context.specification,
      graph: context.graph,
      requiredConfigNames: config.requirements.map((requirement) => requirement.name),
    }),
  );
  return persisted.ok ? { ok: true, value: outcome } : persisted;
};
