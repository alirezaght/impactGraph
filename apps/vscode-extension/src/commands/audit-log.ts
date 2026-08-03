import { existsSync } from 'node:fs';

import { auditLogPath } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { workspaceRoot } from '../workspace.js';

// Story 13.3 — AI audit log viewer (§35/Epic K). Read-only: the shell opens the append-only
// JSONL exactly as recorded by the provider guard; it never rewrites or summarizes it.

export const runOpenAiAuditLog = async (): Promise<void> => {
  const root = workspaceRoot();
  if (root === undefined) {
    void vscode.window.showWarningMessage('ImpactGraph requires an open workspace folder.');
    return;
  }
  const logPath = auditLogPath(root);
  if (!existsSync(logPath)) {
    void vscode.window.showInformationMessage('ImpactGraph: no AI calls recorded yet.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
  await vscode.window.showTextDocument(document, { preview: false });
};
