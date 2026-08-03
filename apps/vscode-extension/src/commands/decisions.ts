import { approveAnalysis, listAnalyses, recordImpactDecision } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { requireTrustedWorkspace } from '../workspace.js';

import type { ImpactTreeNode } from '../views/impact-items.js';

// Story 9.4 — decisions and approval. These are light artifact operations (no indexing), so
// they run in the host. The shell only forwards the user's decision to the engine; it never
// mutates an analysis itself, and approval always demands explicit confirmation (§40.3, §35).

export const runApproveAnalysis = async (): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const analyses = await listAnalyses(root);
  if (!analyses.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${analyses.error.message}`);
    return;
  }
  const approvable = analyses.value.filter(
    (analysis) => analysis.status === 'draft' || analysis.status === 'reviewed',
  );
  if (approvable.length === 0) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: no draft analysis to approve — run "Analyze Specification" first.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    approvable.map((analysis) => ({
      label: analysis.id,
      description: `${analysis.status} · ${String(analysis.impactCount)} impacts · ${analysis.createdAt}`,
      id: analysis.id,
    })),
    { title: 'Approve which impact analysis?' },
  );
  if (picked === undefined) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Approve analysis ${picked.id}? Approval freezes it as the immutable review baseline; further edits require a new analysis version (§40.3).`,
    { modal: true },
    'Approve',
  );
  if (confirmed !== 'Approve') {
    return;
  }
  const approved = await approveAnalysis(root, picked.id);
  if (!approved.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${approved.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: analysis ${picked.id} approved — it is now the frozen review baseline.`,
  );
};

export const runImpactDecision = async (
  node: ImpactTreeNode | undefined,
  decision: 'accepted' | 'rejected',
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const ref = node?.impactRef;
  if (ref === undefined) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: select an impact in the Current Impact view to record a decision.',
    );
    return;
  }
  const reason =
    decision === 'rejected'
      ? await vscode.window.showInputBox({
          title: `Why is '${ref.name}' not affected? (recorded with the decision)`,
          placeHolder: 'optional reason',
        })
      : undefined;
  const recorded = await recordImpactDecision({
    rootDir: root,
    analysisId: ref.analysisId,
    requirementId: ref.requirementId,
    nodeId: ref.nodeId,
    decision,
    ...(reason === undefined || reason.length === 0 ? {} : { reason }),
  });
  if (!recorded.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${recorded.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: '${ref.name}' ${decision} — decision recorded (append-only, the impact stays visible).`,
  );
};
