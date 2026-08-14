import { hasDiscrepancies } from '@impactgraph/domain';
import { isWorkspaceInitialized } from '@impactgraph/persistence';
import { runReviewPipeline } from '@impactgraph/workspace-engine';

import { failed } from '../context.js';

import { runReviewAccept } from './review-accept.js';
import { renderReview } from './review-render.js';

import type { CliFailure, CommandContext, CommandResult } from '../context.js';
import type { ReviewTarget, Result } from '@impactgraph/domain';

// Story 11.4 — `impactgraph review [working-tree|commit]`: compare the latest APPROVED analysis
// against reality via the shared engine. `--analysis <id>` targets a specific stored analysis;
// `--allow-unapproved-baseline` explicitly compares against a never-approved one, and the report
// labels itself provisional. Discrepancies set exit code 3; humans decide policy (§43.6). The
// baseline analysis is never modified by this command, and nothing here approves anything (§40.3).

const parseTarget = (context: CommandContext): Result<ReviewTarget, CliFailure> => {
  const target = context.args[0] ?? 'working-tree';
  if (target !== 'working-tree' && target !== 'commit') {
    return {
      ok: false,
      error: {
        category: 'configurationError',
        message: 'usage: impactgraph review [working-tree|commit]',
      },
    };
  }
  return { ok: true, value: target };
};

export const runReview = async (context: CommandContext): Promise<CommandResult> => {
  if (!isWorkspaceInitialized(context.rootDir)) {
    return failed({
      category: 'configurationError',
      message: 'workspace not initialized — run `impactgraph init` first',
    });
  }
  if (context.args[0] === 'accept') {
    return runReviewAccept(context); // §24.1 accepted deviation on the latest review
  }
  const target = parseTarget(context);
  if (!target.ok) {
    return failed(target.error);
  }
  const bundle = await runReviewPipeline(context.rootDir, target.value, {
    ...(context.analysisId === undefined ? {} : { analysisId: context.analysisId }),
    ...(context.allowUnapprovedBaseline === true ? { allowUnapproved: true } : {}),
  });
  if (!bundle.ok) {
    return failed(bundle.error);
  }
  renderReview(context, {
    review: bundle.value.review,
    analysis: bundle.value.analysis,
    violations: bundle.value.violations,
    breakdownContext: bundle.value.breakdownContext,
  });
  return {
    ok: true,
    warningsFound: false,
    discrepanciesFound: hasDiscrepancies(bundle.value.review) || bundle.value.violations.length > 0,
  };
};
