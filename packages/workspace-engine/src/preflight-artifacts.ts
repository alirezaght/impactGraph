import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { preflightArtifactSchema } from '@impactgraph/contracts';

import { failWith } from './failure.js';
import {
  summaryFindings,
  toAssessmentDto,
  toClassificationDtos,
  toIndependenceDto,
} from './reports/preflight-block.js';

import type { Failable } from './failure.js';
import type { PreflightOutcome } from './preflight.js';
import type { PreflightArtifactDto } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, NodeId, Specification } from '@impactgraph/domain';

/**
 * Persisted preflight outcomes (ADR-0017; spec R18), one frozen artifact per analysis run.
 *
 * The analysis artifact stays untouched — its store enforces "content is immutable", and the
 * findings are DERIVED knowledge over the analysis, the constraint layer and the runtime layer.
 * Persisting them separately keeps that boundary and still gives review and the explicit red-team
 * view (`list_preflight_findings`) the approval-time knowledge after the analysis is frozen.
 */

export const preflightArtifactsDir = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts', 'preflights');

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Node types that mean "a process serves traffic here" — what the plan says runs. */
const PROCESS_TYPES = new Set(['container', 'runtime-process', 'cloud-run-service', 'cloud-run-job']);

const runtimeProcessNodeIds = (analysis: ImpactAnalysis, graph: KnowledgeGraph): string[] => {
  const ids = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    const type = graph.nodes.get(impact.nodeId as NodeId)?.type;
    if (type !== undefined && PROCESS_TYPES.has(type)) {
      ids.add(impact.nodeId);
    }
  }
  return [...ids].sort();
};

export interface BuildPreflightArtifactInput {
  readonly outcome: PreflightOutcome;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  readonly graph: KnowledgeGraph;
  readonly requiredConfigNames: readonly string[];
}

export const buildPreflightArtifact = (
  input: BuildPreflightArtifactInput,
): PreflightArtifactDto => ({
  schemaVersion: 1,
  analysisId: input.analysis.id,
  specificationId: input.specification.id,
  specificationVersion: input.specification.version,
  repositorySnapshotId: input.analysis.repositorySnapshotId,
  createdAt: input.analysis.createdAt,
  assessment: toAssessmentDto(input.outcome),
  // The FULL list — the analyze summary's bounded slice is a view, the artifact is the record.
  findings: [...summaryFindings(input.outcome, input.outcome.findings.length)],
  classifications: [...toClassificationDtos(input.outcome)],
  evidenceIndependence: toIndependenceDto(input.outcome),
  constraintCoverage: {
    indexedConstraintCount: input.outcome.constraintCount,
    opaqueGuardPaths: [...input.outcome.opaqueGuardPaths],
  },
  planContract: {
    requiredConfigNames: [...input.requiredConfigNames].sort(),
    runtimeProcessNodeIds: runtimeProcessNodeIds(input.analysis, input.graph),
    constraintIds: [...input.outcome.constraintIds].sort(),
  },
});

export const savePreflightArtifact = (
  rootDir: string,
  artifact: PreflightArtifactDto,
): Failable<void> => {
  const validated = preflightArtifactSchema.safeParse(artifact);
  if (!validated.success || !SAFE_ID.test(artifact.analysisId)) {
    return failWith('internalError', 'preflight artifact failed contract validation');
  }
  try {
    mkdirSync(preflightArtifactsDir(rootDir), { recursive: true });
    const target = join(preflightArtifactsDir(rootDir), `${artifact.analysisId}.json`);
    // Frozen at write time: an analysis id is written once (new run → new analysis id → new file),
    // and an existing artifact is never rewritten.
    if (existsSync(target)) {
      return { ok: true, value: undefined };
    }
    writeFileSync(`${target}.tmp`, JSON.stringify(validated.data, null, 2), 'utf8');
    renameSync(`${target}.tmp`, target);
    return { ok: true, value: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot persist preflight artifact: ${message}`);
  }
};

export const loadPreflightArtifact = (
  rootDir: string,
  analysisId: string,
): Failable<PreflightArtifactDto | undefined> => {
  if (!SAFE_ID.test(analysisId)) {
    return failWith('configurationError', `unsafe analysis id '${analysisId}'`);
  }
  const file = join(preflightArtifactsDir(rootDir), `${analysisId}.json`);
  if (!existsSync(file)) {
    return { ok: true, value: undefined };
  }
  try {
    const parsed = preflightArtifactSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failWith(
          'configurationError',
          `stored preflight outcome '${analysisId}' failed contract validation`,
        );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot read preflight outcome: ${message}`);
  }
};

/** The most recently written outcome — the default subject of `list_preflight_findings`. */
export const latestPreflightArtifact = (
  rootDir: string,
): Failable<PreflightArtifactDto | undefined> => {
  const dir = preflightArtifactsDir(rootDir);
  if (!existsSync(dir)) {
    return { ok: true, value: undefined };
  }
  const names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  let latest: PreflightArtifactDto | undefined;
  for (const name of names) {
    const loaded = loadPreflightArtifact(rootDir, name.slice(0, -'.json'.length));
    if (!loaded.ok) {
      return loaded;
    }
    if (loaded.value !== undefined && (latest === undefined || loaded.value.createdAt > latest.createdAt)) {
      latest = loaded.value;
    }
  }
  return { ok: true, value: latest };
};
