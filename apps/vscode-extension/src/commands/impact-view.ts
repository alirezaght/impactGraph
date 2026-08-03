import { findComponents, listAnalyses, recordImpactDecision } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { requireTrustedWorkspace } from '../workspace.js';

import type { ImpactTreeProvider } from '../views/impact-tree.js';

// Story 9.2 (filters/grouping) + 9.5 (manual impact picker). The shell collects choices and
// reprojects or forwards them — filtering is pure mapping, manual impacts go through the
// engine's node-validated decision path (free-text component names are impossible).

const LIKELIHOODS = ['required', 'likely', 'possible', 'unlikely'];

const pickMany = async (
  title: string,
  values: readonly string[],
): Promise<readonly string[] | undefined> => {
  const picked = await vscode.window.showQuickPick(
    values.map((value) => ({ label: value, picked: true })),
    { title, canPickMany: true },
  );
  return picked?.map((item) => item.label);
};

export const runFilterImpacts = async (impactTree: ImpactTreeProvider): Promise<void> => {
  const output = impactTree.current;
  if (output === undefined) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: no analysis loaded — run "Analyze Specification" first.',
    );
    return;
  }
  const grouping = await vscode.window.showQuickPick(
    [
      { label: 'By requirement', id: 'requirement' as const },
      { label: 'By impact type', id: 'impact-type' as const },
    ],
    { title: 'Group impacts by (§18.3/§18.4)' },
  );
  if (grouping === undefined) {
    return;
  }
  const likelihoods = await pickMany('Show likelihoods (§40.4)', LIKELIHOODS);
  if (likelihoods === undefined) {
    return;
  }
  const presentTypes = [
    ...new Set(
      output.requirements.flatMap((requirement) =>
        requirement.impacts.map((impact) => impact.impactType),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const impactTypes = await pickMany('Show impact types (§40.4)', presentTypes);
  if (impactTypes === undefined) {
    return;
  }
  impactTree.setViewOptions({
    grouping: grouping.id,
    ...(likelihoods.length === LIKELIHOODS.length ? {} : { likelihoods }),
    ...(impactTypes.length === presentTypes.length ? {} : { impactTypes }),
  });
};

export const runClearImpactFilters = (impactTree: ImpactTreeProvider): void => {
  impactTree.setViewOptions({});
};

/** 9.5: manual impacts always reference an EXISTING graph node — searched, never typed free. */
export const runAddManualImpact = async (): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const analyses = await listAnalyses(root);
  if (!analyses.ok || analyses.value.length === 0) {
    void vscode.window.showInformationMessage('ImpactGraph: no analyses yet — analyze first.');
    return;
  }
  const analysis = await vscode.window.showQuickPick(
    analyses.value.map((entry) => ({
      label: entry.id,
      description: `${entry.status} · ${String(entry.impactCount)} impacts`,
      entry,
    })),
    { title: 'Add a manual impact to which analysis?' },
  );
  if (analysis === undefined) {
    return;
  }
  const query = await vscode.window.showInputBox({
    title: 'Search components (name fragment — the impact must reference a real node, §40.3)',
  });
  if (query === undefined || query.length === 0) {
    return;
  }
  const hits = await findComponents(root, query);
  if (!hits.ok || hits.value.length === 0) {
    void vscode.window.showWarningMessage(`ImpactGraph: no component matches '${query}'.`);
    return;
  }
  const component = await vscode.window.showQuickPick(
    hits.value.map((hit) => ({
      label: hit.name,
      description: `${hit.category}/${hit.type} · ${hit.provenance}${hit.path === undefined ? '' : ` · ${hit.path}`}`,
      hit,
    })),
    { title: 'Which component is affected?' },
  );
  if (component === undefined) {
    return;
  }
  await submitManualImpact(root, analysis.entry.id, component.hit.nodeId, component.label);
};

const submitManualImpact = async (
  root: string,
  analysisId: string,
  nodeId: string,
  name: string,
): Promise<void> => {
  const requirementId = await vscode.window.showInputBox({
    title: `Which requirement does '${name}' serve? (requirement id from the analysis)`,
  });
  if (requirementId === undefined || requirementId.length === 0) {
    return;
  }
  const reason = await vscode.window.showInputBox({
    title: 'Why is it affected? (recorded with the human-confirmed decision)',
  });
  const recorded = await recordImpactDecision({
    rootDir: root,
    analysisId,
    requirementId,
    nodeId,
    decision: 'manually-added',
    ...(reason === undefined || reason.length === 0 ? {} : { reason }),
  });
  if (!recorded.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${recorded.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: manual impact on '${name}' recorded with human-confirmed provenance (§12.3).`,
  );
};
