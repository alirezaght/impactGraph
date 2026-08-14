import { analogousSqlLiterals } from './analogous-sql.js';
import { runPreflightForAnalysis } from './preflight.js';
import {
  buildWorkspaceCoverage,
  unindexedRegisteredRepositories,
} from './reports/workspace-coverage-block.js';

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
  'coverageInsufficient' | 'missingRepositoryNames' | 'analogousLiterals'
>;

export const runCoveragePreflight = async (
  context: CoveragePreflightContext,
  workspace: WorkspaceRepositoryContext,
): Promise<PreflightOutcome> => {
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
  return runPreflightForAnalysis({
    ...context,
    analogousLiterals,
    coverageInsufficient: coverage.status === 'insufficient-coverage',
    missingRepositoryNames: unindexedRegisteredRepositories(workspace).map((state) => state.name),
  });
};
