import * as vscode from 'vscode';

/** The single-root workspace folder ImpactGraph operates on, if any. */
export const workspaceRoot = (): string | undefined =>
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

/** Repository content is parsed (never executed), but untrusted workspaces stay untouched. */
export const requireTrustedWorkspace = (): string | undefined => {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      'ImpactGraph is disabled in untrusted workspaces. Trust this workspace to enable indexing.',
    );
    return undefined;
  }
  const root = workspaceRoot();
  if (root === undefined) {
    void vscode.window.showWarningMessage('ImpactGraph requires an open workspace folder.');
  }
  return root;
};
