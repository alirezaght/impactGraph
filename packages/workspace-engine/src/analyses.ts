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
