import { isAnalysisStale } from '@impactgraph/domain';
import {
  artifactsPath,
  createImpactAnalysisArtifactStore,
  createSpecificationArtifactStore,
} from '@impactgraph/persistence';

import type { Failable } from './failure.js';
import type { ImpactAnalysis } from '@impactgraph/domain';

export interface AnalysisListing {
  readonly id: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly status: string;
  readonly createdAt: string;
  readonly impactCount: number;
  readonly decisionCount: number;
  /** Derived at read time (Story 5.4): the spec moved past the version this analysis saw.
   *  Never persisted — mutating a spec leaves stored analyses untouched (§40.2). */
  readonly stale: boolean;
}

/** Latest stored version per specification id — the reference point for staleness. */
const currentSpecificationVersions = async (
  rootDir: string,
  analyses: readonly ImpactAnalysis[],
): Promise<ReadonlyMap<string, number>> => {
  const store = createSpecificationArtifactStore(artifactsPath(rootDir));
  const versions = new Map<string, number>();
  for (const id of new Set(analyses.map((analysis) => analysis.specificationId))) {
    const latest = await store.getLatest(id);
    if (latest.ok && latest.value !== undefined) {
      versions.set(id, latest.value.version);
    }
  }
  return versions;
};

/** All stored analyses, newest first — for pickers and status surfaces. */
export const listAnalyses = async (rootDir: string): Promise<Failable<AnalysisListing[]>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
  const all = await store.listAll();
  if (!all.ok) {
    return { ok: false, error: { category: 'configurationError', message: all.error.message } };
  }
  const specVersions = await currentSpecificationVersions(rootDir, all.value);
  return {
    ok: true,
    value: [...all.value]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((analysis) => ({
        id: analysis.id,
        specificationId: analysis.specificationId,
        specificationVersion: analysis.specificationVersion,
        status: analysis.status,
        createdAt: analysis.createdAt,
        impactCount: analysis.requirementImpacts.length,
        decisionCount: analysis.userDecisions.length,
        stale: isAnalysisStale(
          analysis,
          specVersions.get(analysis.specificationId) ?? analysis.specificationVersion,
        ),
      })),
  };
};

/**
 * The most recently created analysis, whatever its status — the default subject of a follow-up
 * query such as `list_impacts` immediately after `analyze_impact`. Deliberately NOT the approved
 * one: paging through the impacts of a draft is the common case, and requiring approval first
 * would make the bounded summary's follow-up path unusable.
 */
export const latestAnalysis = async (rootDir: string): Promise<Failable<ImpactAnalysis>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
  const all = await store.listAll();
  if (!all.ok) {
    return { ok: false, error: { category: 'configurationError', message: all.error.message } };
  }
  const latest = [...all.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
  if (latest === undefined) {
    return {
      ok: false,
      error: {
        category: 'configurationError',
        message: 'no impact analysis has been built yet — run analyze_impact first',
      },
    };
  }
  return { ok: true, value: latest };
};

/** Load a stored analysis regardless of status (read-only access). */
export const loadAnalysis = async (
  rootDir: string,
  analysisId: string,
): Promise<Failable<ImpactAnalysis>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
  const loaded = await store.get(analysisId);
  if (!loaded.ok) {
    return { ok: false, error: { category: 'configurationError', message: loaded.error.message } };
  }
  if (loaded.value === undefined) {
    return {
      ok: false,
      error: { category: 'configurationError', message: `analysis not found: ${analysisId}` },
    };
  }
  return { ok: true, value: loaded.value };
};

/**
 * Resolve the approved analysis a review/export runs against: by id when given, otherwise the
 * most recently created approved one. Anything not approved is a configuration error — the
 * human-approval gate is never bypassed (§40.3).
 */
export const loadApprovedAnalysis = async (
  rootDir: string,
  analysisId?: string,
): Promise<Failable<ImpactAnalysis>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
  if (analysisId !== undefined) {
    const loaded = await store.get(analysisId);
    if (!loaded.ok) {
      return {
        ok: false,
        error: { category: 'configurationError', message: loaded.error.message },
      };
    }
    if (loaded.value === undefined) {
      return {
        ok: false,
        error: { category: 'configurationError', message: `analysis not found: ${analysisId}` },
      };
    }
    if (loaded.value.status !== 'approved') {
      return {
        ok: false,
        error: {
          category: 'configurationError',
          message: `analysis '${analysisId}' is '${loaded.value.status}' — approve it first (\`impactgraph approve ${analysisId}\`)`,
        },
      };
    }
    return { ok: true, value: loaded.value };
  }
  const all = await store.listAll();
  if (!all.ok) {
    return { ok: false, error: { category: 'configurationError', message: all.error.message } };
  }
  const approved = all.value
    .filter((analysis) => analysis.status === 'approved')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = approved[approved.length - 1];
  if (latest === undefined) {
    return {
      ok: false,
      error: {
        category: 'configurationError',
        message: 'no approved impact analysis — run `impactgraph approve <analysisId>` first',
      },
    };
  }
  return { ok: true, value: latest };
};

/** What the review baseline speaks for: a human-approved contract, or a draft prediction. */
export type BaselineAuthority = 'approved-contract' | 'unapproved-prediction';

export interface ReviewBaseline {
  readonly analysis: ImpactAnalysis;
  readonly authority: BaselineAuthority;
}

export interface ReviewBaselineOptions {
  /** Load exactly this analysis instead of resolving the default baseline. */
  readonly analysisId?: string | undefined;
  /** The caller explicitly allows a never-approved baseline — stated, never defaulted. */
  readonly allowUnapproved?: boolean | undefined;
}

/** Live-but-unapproved analyses (draft/reviewed), newest last — provisional-baseline candidates. */
const unapprovedCandidates = async (rootDir: string): Promise<readonly ImpactAnalysis[]> => {
  const all = await createImpactAnalysisArtifactStore(artifactsPath(rootDir)).listAll();
  if (!all.ok) {
    return [];
  }
  return all.value
    .filter((analysis) => analysis.status === 'draft' || analysis.status === 'reviewed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

/** When approval is missing but a draft exists, the refusal names the way forward (best effort). */
const withDraftHint = async (
  rootDir: string,
  error: { category: string; message: string },
  analysisId: string | undefined,
): Promise<{ category: 'configurationError'; message: string }> => {
  const candidates = await unapprovedCandidates(rootDir);
  const requested = candidates.find((analysis) => analysis.id === analysisId);
  const suggested = requested ?? candidates[candidates.length - 1];
  return {
    category: 'configurationError',
    message:
      suggested === undefined
        ? error.message
        : `${error.message} — or pass allowUnapprovedBaseline (CLI: --allow-unapproved-baseline) to compare against draft analysis '${suggested.id}' (provisional)`,
  };
};

/**
 * Resolve the analysis a review compares the implementation against, with its authority.
 * Default: exactly `loadApprovedAnalysis` — the §40.3 gate — plus a recovery hint when a draft
 * exists. With `allowUnapproved` the caller explicitly accepts a provisional baseline: the named
 * analysis, or the most recent non-superseded one. `superseded` is always rejected — a retired
 * record is not a prediction. Nothing here approves anything; §40.3 is untouched.
 */
export const loadReviewBaseline = async (
  rootDir: string,
  options: ReviewBaselineOptions = {},
): Promise<Failable<ReviewBaseline>> => {
  if (options.allowUnapproved !== true) {
    const approved = await loadApprovedAnalysis(rootDir, options.analysisId);
    if (approved.ok) {
      return { ok: true, value: { analysis: approved.value, authority: 'approved-contract' } };
    }
    return { ok: false, error: await withDraftHint(rootDir, approved.error, options.analysisId) };
  }
  if (options.analysisId !== undefined) {
    const loaded = await loadAnalysis(rootDir, options.analysisId);
    if (!loaded.ok) {
      return loaded;
    }
    if (loaded.value.status === 'superseded') {
      return {
        ok: false,
        error: {
          category: 'configurationError',
          message: `analysis '${options.analysisId}' is superseded — a retired record is not a prediction; review against its successor or the approved baseline`,
        },
      };
    }
    return { ok: true, value: toBaseline(loaded.value) };
  }
  const approved = await loadApprovedAnalysis(rootDir);
  const candidates = await unapprovedCandidates(rootDir);
  const newestUnapproved = candidates[candidates.length - 1];
  // "Most recent non-superseded": the newest of the approved baseline and the live drafts.
  const newest = [approved.ok ? approved.value : undefined, newestUnapproved]
    .filter((analysis): analysis is ImpactAnalysis => analysis !== undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop();
  if (newest === undefined) {
    return {
      ok: false,
      error: {
        category: 'configurationError',
        message: 'no impact analysis has been built yet — run analyze_impact first',
      },
    };
  }
  return { ok: true, value: toBaseline(newest) };
};

const toBaseline = (analysis: ImpactAnalysis): ReviewBaseline => ({
  analysis,
  authority: analysis.status === 'approved' ? 'approved-contract' : 'unapproved-prediction',
});
