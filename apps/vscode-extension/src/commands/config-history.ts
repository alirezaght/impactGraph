import {
  configHistory,
  restoreConfigVersion,
  rollbackConfigChange,
} from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { requireTrustedWorkspace } from '../workspace.js';

// Story 14.4 — configuration history + undo in the shell. Rollback appends an audit entry
// (§Z14); the modal makes the material nature of the change explicit (§Z11).

export const runOpenConfigHistory = async (): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const history = configHistory(root);
  if (!history.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${history.error.message}`);
    return;
  }
  const lines =
    history.value.length === 0
      ? ['No configuration changes recorded.']
      : history.value.map(
          (entry) =>
            `- ${entry.timestamp} \`${entry.rollbackId}\` [${entry.classification}/${entry.approval}] **${entry.file}** — ${entry.reason}${entry.rollbackOf === undefined ? '' : ` _(rollback of ${entry.rollbackOf})_`}`,
        );
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: ['# ImpactGraph Configuration History (§Z12)', '', ...lines].join('\n'),
  });
  await vscode.window.showTextDocument(document, { preview: false });
};

export const runUndoLastConfigChange = async (): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    'Undo the last configuration change? The prior document is restored and the undo itself is recorded in the audit trail (§Z14).',
    { modal: true },
    'Undo',
  );
  if (confirmed !== 'Undo') {
    return;
  }
  const rolled = rollbackConfigChange({ rootDir: root, actor: { kind: 'user' } });
  if (!rolled.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${rolled.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: restored ${rolled.value.file} (undid ${rolled.value.rollbackOf ?? '?'}).`,
  );
};

export const runRestoreConfigVersion = async (): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const history = configHistory(root);
  if (!history.ok || history.value.length === 0) {
    void vscode.window.showInformationMessage('ImpactGraph: no configuration history yet.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    [...history.value].reverse().map((entry) => ({
      label: entry.rollbackId,
      description: `${entry.timestamp} · ${entry.file} · ${entry.reason}`,
      id: entry.rollbackId,
    })),
    { title: 'Restore configuration to the state AFTER which change? (§Z14)' },
  );
  if (picked === undefined) {
    return;
  }
  const restored = restoreConfigVersion(root, picked.id, { kind: 'user' });
  if (!restored.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${restored.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: restored ${restored.value.file} to the state after ${picked.id}.`,
  );
};
