import { addUserDecision, approveImpactAnalysis } from '@impactgraph/domain';
import { artifactsPath, createImpactAnalysisArtifactStore } from '@impactgraph/persistence';

import { failWith } from './failure.js';
import { loadGraphAt, withIndexStore } from './graphs.js';
import { appendLearningProposal } from './learning.js';

import type { Failable } from './failure.js';
import type { ImpactAnalysis, NodeId, UserDecisionKind } from '@impactgraph/domain';

// Decision + approval workflow (PRD §40.3): decisions are append-only; approval freezes.
// Neither operation is ever taken by ImpactGraph on its own — callers act for a human.

export const approveAnalysis = async (
  rootDir: string,
  analysisId: string,
): Promise<Failable<ImpactAnalysis>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
  const loaded = await store.get(analysisId);
  if (!loaded.ok) {
    return failWith('configurationError', loaded.error.message);
  }
  if (loaded.value === undefined) {
    return failWith('configurationError', `analysis not found: ${analysisId}`);
  }
  const approved = approveImpactAnalysis(loaded.value);
  if (!approved.ok) {
    return failWith(
      'configurationError',
      `analysis '${analysisId}' is '${loaded.value.status}' — only draft or reviewed analyses can be approved`,
    );
  }
  const saved = await store.save(approved.value);
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  return { ok: true, value: approved.value };
};

export interface ImpactDecisionRequest {
  readonly rootDir: string;
  readonly analysisId: string;
  readonly requirementId: string;
  readonly nodeId: string;
  readonly decision: UserDecisionKind;
  readonly reason?: string | undefined;
}

const validateDecisionTarget = async (
  request: ImpactDecisionRequest,
  analysis: ImpactAnalysis,
): Promise<Failable<void>> => {
  if (request.decision === 'manually-added') {
    // A manual impact still requires an existing node (impact-model skill: no free-text names).
    return withIndexStore(request.rootDir, async (store) => {
      const graph = await loadGraphAt(store, analysis.repositorySnapshotId, 'analysis');
      if (!graph.ok) {
        return graph;
      }
      if (!graph.value.nodes.has(request.nodeId as NodeId)) {
        return failWith(
          'configurationError',
          `node '${request.nodeId}' does not exist in the analyzed graph — manual impacts must reference a real node`,
        );
      }
      return { ok: true, value: undefined };
    });
  }
  const known = analysis.requirementImpacts.some(
    (impact) => impact.requirementId === request.requirementId && impact.nodeId === request.nodeId,
  );
  if (!known) {
    return failWith(
      'configurationError',
      `no impact for requirement '${request.requirementId}' and node '${request.nodeId}' in analysis '${request.analysisId}'`,
    );
  }
  return { ok: true, value: undefined };
};

/** Append an accept/reject/manual-add decision (rejected impacts stay visible, §40.3). */
export const recordImpactDecision = async (
  request: ImpactDecisionRequest,
): Promise<Failable<ImpactAnalysis>> => {
  const store = createImpactAnalysisArtifactStore(artifactsPath(request.rootDir));
  const loaded = await store.get(request.analysisId);
  if (!loaded.ok) {
    return failWith('configurationError', loaded.error.message);
  }
  if (loaded.value === undefined) {
    return failWith('configurationError', `analysis not found: ${request.analysisId}`);
  }
  const target = await validateDecisionTarget(request, loaded.value);
  if (!target.ok) {
    return target;
  }
  const decidedAt = new Date().toISOString();
  const updated = addUserDecision(loaded.value, {
    id: `decision-${Date.now().toString(36)}`,
    requirementId: request.requirementId,
    nodeId: request.nodeId,
    decision: request.decision,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    decidedAt,
  });
  if (!updated.ok) {
    return failWith(
      'configurationError',
      updated.error.issues[0]?.message ?? 'decision rejected by domain rules',
    );
  }
  const saved = await store.save(updated.value);
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  recordRejectionLearning(request);
  return { ok: true, value: updated.value };
};

/** §Z9: a rejected impact is a correction worth learning from — queued with a suggested
 *  add-exclusion operation (mode-gated like every configuration change). */
const recordRejectionLearning = (request: ImpactDecisionRequest): void => {
  if (request.decision !== 'rejected') {
    return;
  }
  appendLearningProposal(request.rootDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    kind: 'rejected-impact',
    detail: `impact on '${request.nodeId}' for ${request.requirementId} rejected${request.reason === undefined ? '' : `: ${request.reason}`}`,
    suggestedOperation: {
      kind: 'add-exclusion',
      component: request.nodeId.includes('#')
        ? request.nodeId.slice(request.nodeId.lastIndexOf('#') + 1)
        : request.nodeId,
      reason: request.reason ?? `rejected as an impact for ${request.requirementId}`,
      confidence: 0.5,
    },
  });
};
