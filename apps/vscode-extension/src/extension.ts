// ImpactGraph extension shell (Story 7.1). activate() stays lazy: registrations only —
// no indexing, no SQLite open, no config parse (PRD §33: activation < 500 ms).
import * as vscode from 'vscode';

import { registerCommands } from './commands/register-commands.js';
import { buildExtensionApi } from './extension-api.js';
import { createStatusBar } from './status-bar.js';
import { ArchitectureTreeProvider } from './views/architecture-tree.js';
import { ImpactTreeProvider } from './views/impact-tree.js';
import { IssuesTreeProvider } from './views/issues-tree.js';
import { ReviewTreeProvider } from './views/review-tree.js';
import { ImpactReviewPanel } from './webview/panel.js';

import type { ImpactGraphExtensionApi } from './extension-api.js';

export const activate = (context: vscode.ExtensionContext): ImpactGraphExtensionApi => {
  const output = vscode.window.createOutputChannel('ImpactGraph');
  context.subscriptions.push(output);

  const architectureTree = new ArchitectureTreeProvider();
  const impactTree = new ImpactTreeProvider();
  const reviewTree = new ReviewTreeProvider();
  const issuesTree = new IssuesTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('impactgraph.architecture', architectureTree),
    vscode.window.registerTreeDataProvider('impactgraph.currentImpact', impactTree),
    vscode.window.registerTreeDataProvider('impactgraph.review', reviewTree),
    vscode.window.registerTreeDataProvider('impactgraph.issues', issuesTree),
  );

  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar.item);

  registerCommands(context, {
    output,
    architectureTree,
    impactTree,
    reviewTree,
    issuesTree,
    statusBar,
  });

  // Populate the status bar lazily — after activation, never blocking it.
  setTimeout(() => {
    void statusBar.refresh();
  }, 0);

  // Empty in Development and Production; see extension-api.ts for why the gate is load-bearing.
  return buildExtensionApi({
    mode: context.extensionMode,
    testMode: vscode.ExtensionMode.Test,
    secrets: context.secrets,
    reviewPanel: () => ImpactReviewPanel.current(),
  });
};

export const deactivate = (): void => {
  // Subscriptions are disposed by VS Code; the index worker exits with its own process.
};
