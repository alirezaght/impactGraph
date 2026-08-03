import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensureWorkspaceScaffold,
  indexDatabasePath,
  isWorkspaceInitialized,
  openSqliteIndexStore,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from '@impactgraph/persistence';
import { detectStack } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { recordTelemetry } from '../telemetry/client.js';
import { commandExecuted } from '../telemetry/events.js';
import { requireTrustedWorkspace, workspaceRoot } from '../workspace.js';

import { runOpenAiAuditLog } from './audit-log.js';
import {
  runOpenConfigHistory,
  runRestoreConfigVersion,
  runUndoLastConfigChange,
} from './config-history.js';
import { runAssignToContext, runIgnorePath, runMarkAsDomainComponent } from './corrections.js';
import { runApproveAnalysis, runImpactDecision } from './decisions.js';
import { stackSummaryMessage } from './editor-context-items.js';
import {
  runAnalyzeSelection,
  runShowArchitecturalDependencies,
  runShowRequirementImpacts,
} from './editor-context.js';
import { runAddManualImpact, runClearImpactFilters, runFilterImpacts } from './impact-view.js';
import { runConfigureModelProvider } from './provider-config.js';
import { runReindex } from './reindex.js';
import { runRevealNode } from './reveal-node.js';
import {
  openReviewPanel,
  runCompareSpecificationVersions,
  runImportSpecification,
  runSaveSpecificationVersion,
} from './specification-panel.js';
import {
  runAnalyzeSpecification,
  runExportContext,
  runOpenReviewReport,
  runReviewCommand,
} from './workflows.js';

import type { StatusBar } from '../status-bar.js';
import type { ArchitectureItem, ArchitectureTreeProvider } from '../views/architecture-tree.js';
import type { ImpactTreeNode } from '../views/impact-items.js';
import type { ImpactTreeProvider } from '../views/impact-tree.js';
import type { IssuesTreeProvider } from '../views/issues-tree.js';
import type { ReviewTreeProvider } from '../views/review-tree.js';

interface Wiring {
  readonly output: vscode.OutputChannel;
  readonly architectureTree: ArchitectureTreeProvider;
  readonly impactTree: ImpactTreeProvider;
  readonly reviewTree: ReviewTreeProvider;
  readonly issuesTree: IssuesTreeProvider;
  readonly statusBar: StatusBar;
}

const PRIVACY_MODES = [
  'local-only',
  'selected-snippets',
  'full-context',
  'external-agent',
] as const;

/**
 * §10.1 step 6 — detection-review summary after init. Detection reads the persisted graph;
 * before the first index exists it fails, and the message falls back to the reindex hint.
 */
const showDetectionSummary = async (root: string, created: readonly string[]): Promise<void> => {
  const detection = await detectStack(root);
  const initNote =
    created.length > 0 ? `initialized (${created.join(', ')})` : 'workspace already initialized';
  const message = detection.ok
    ? `ImpactGraph: ${initNote}. Detected ${stackSummaryMessage(detection.value)}.`
    : `ImpactGraph: ${initNote}. Run "Reindex Workspace" to detect languages and frameworks.`;
  const action = await vscode.window.showInformationMessage(message, 'Reindex Now');
  if (action === 'Reindex Now') {
    await vscode.commands.executeCommand('impactgraph.reindexWorkspace');
  }
};

const runInit = async (statusBar: StatusBar): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const scaffold = ensureWorkspaceScaffold(root);
  if (!scaffold.ok) {
    void vscode.window.showErrorMessage(
      `ImpactGraph: initialization failed — ${scaffold.error.message}`,
    );
    return;
  }
  await statusBar.refresh();
  await showDetectionSummary(root, scaffold.value.created);
};

const runShowStatus = async (output: vscode.OutputChannel): Promise<void> => {
  const root = workspaceRoot();
  if (root === undefined) {
    return;
  }
  const dbPath = indexDatabasePath(root);
  if (!isWorkspaceInitialized(root) || !existsSync(dbPath)) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: not indexed yet — run "Initialize Workspace" then "Reindex Workspace".',
    );
    return;
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    void vscode.window.showErrorMessage('ImpactGraph: index store unavailable.');
    return;
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    const run = await store.value.getRunRecord();
    output.appendLine(`[status] snapshot: ${current.ok ? (current.value ?? 'none') : 'unknown'}`);
    if (run.ok && run.value !== undefined) {
      output.appendLine(
        `[status] last run: ${run.value.finishedAt} — ${String(run.value.fileCount)} files, ` +
          `${String(run.value.nodeCount)} nodes, ${String(run.value.durationMs)} ms, ` +
          `${String(run.value.warningCount)} warnings`,
      );
      for (const warning of run.value.warnings.slice(0, 10)) {
        output.appendLine(`[status]   - ${warning}`);
      }
    }
    output.show(true);
  } finally {
    await store.value.close();
  }
};

const runClearCache = async (statusBar: StatusBar): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const cacheDir = join(root, '.impactgraph', 'cache');
  const confirmed = await vscode.window.showWarningMessage(
    'Delete the local ImpactGraph index cache? It will be rebuilt on the next reindex; artifacts and configuration are untouched.',
    { modal: true },
    'Delete Cache',
  );
  if (confirmed !== 'Delete Cache') {
    return;
  }
  rmSync(cacheDir, { recursive: true, force: true });
  void vscode.window.showInformationMessage('ImpactGraph: local cache cleared.');
  await statusBar.refresh();
};

const runConfigurePrivacy = async (statusBar: StatusBar): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const config = readWorkspaceConfig(root);
  if (!config.ok) {
    void vscode.window.showErrorMessage(
      `ImpactGraph: cannot read config — ${config.error.message}`,
    );
    return;
  }
  const current = config.value?.privacyMode ?? 'selected-snippets';
  const picked = await vscode.window.showQuickPick(
    PRIVACY_MODES.map((mode) => ({
      label: mode,
      ...(mode === current ? { description: 'current' } : {}),
    })),
    { title: 'ImpactGraph privacy mode (PRD §9) — nothing leaves this machine without it' },
  );
  if (picked === undefined || picked.label === current) {
    return;
  }
  const written = writeWorkspaceConfig(root, {
    ...(config.value ?? { schemaVersion: 1 }),
    privacyMode: picked.label,
  });
  if (!written.ok) {
    void vscode.window.showErrorMessage(
      `ImpactGraph: could not update config — ${written.error.message}`,
    );
    return;
  }
  void vscode.window.showInformationMessage(`ImpactGraph: privacy mode set to ${picked.label}.`);
  await statusBar.refresh();
};

/**
 * §16/§19 corrections. Reachable from the architecture tree (the clicked item is passed in) and
 * from the editor context menu (no item — the active file is the target). Each handler asks the
 * user, then hands a structured operation to the engine; the tree re-reads afterwards.
 */
const registerCorrectionCommands = (context: vscode.ExtensionContext, wiring: Wiring): void => {
  const refresh = (): void => {
    wiring.architectureTree.refresh();
    wiring.issuesTree.refresh();
  };
  const corrections: Readonly<
    Record<
      string,
      (request: { item: ArchitectureItem | undefined; refresh: () => void }) => unknown
    >
  > = {
    'impactgraph.markAsDomainComponent': runMarkAsDomainComponent,
    'impactgraph.assignToContext': runAssignToContext,
    'impactgraph.ignorePath': runIgnorePath,
  };
  for (const [id, handler] of Object.entries(corrections)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (item?: ArchitectureItem) => {
        recordTelemetry(commandExecuted(id)); // §36: allowlisted, off by default
        return handler({ item, refresh });
      }),
    );
  }
};

/**
 * Story 9.1 — the §18.2 review panel and its §19 specification commands. Each one resolves what
 * the user pointed at and forwards a typed webview message; the panel does the rendering.
 */
const registerPanelCommands = (context: vscode.ExtensionContext, wiring: Wiring): void => {
  const panelWiring = {
    context,
    output: wiring.output,
    impactTree: wiring.impactTree,
    reviewTree: wiring.reviewTree,
  };
  const panelCommands: Readonly<Record<string, () => unknown>> = {
    'impactgraph.openImpactReview': () => openReviewPanel(panelWiring),
    'impactgraph.importSpecification': () => runImportSpecification(panelWiring),
    'impactgraph.saveSpecificationVersion': () => runSaveSpecificationVersion(panelWiring),
    'impactgraph.compareSpecificationVersions': () => runCompareSpecificationVersions(panelWiring),
  };
  for (const [id, handler] of Object.entries(panelCommands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        recordTelemetry(commandExecuted(id)); // §36: allowlisted, off by default
        return handler();
      }),
    );
  }
};

export const registerCommands = (context: vscode.ExtensionContext, wiring: Wiring): void => {
  const register = (id: string, handler: () => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        recordTelemetry(commandExecuted(id)); // §36: allowlisted, off by default
        return handler();
      }),
    );
  };
  register('impactgraph.initializeWorkspace', () => runInit(wiring.statusBar));
  register('impactgraph.reindexWorkspace', async () => {
    await runReindex(context, wiring.output);
    wiring.architectureTree.refresh();
    wiring.issuesTree.refresh(); // §Z19.10: repository changes re-trigger drift detection
    await wiring.statusBar.refresh();
  });
  register('impactgraph.refreshIssues', () => {
    wiring.issuesTree.refresh();
  });
  register('impactgraph.showIndexStatus', () => runShowStatus(wiring.output));
  register('impactgraph.clearLocalCache', async () => {
    await runClearCache(wiring.statusBar);
    wiring.architectureTree.refresh();
  });
  register('impactgraph.configurePrivacy', () => runConfigurePrivacy(wiring.statusBar));
  register('impactgraph.configureModelProvider', () => runConfigureModelProvider(context));
  register('impactgraph.openConfigurationHistory', () => runOpenConfigHistory());
  register('impactgraph.undoLastConfigurationChange', () => runUndoLastConfigChange());
  register('impactgraph.restoreConfigurationVersion', () => runRestoreConfigVersion());
  register('impactgraph.analyzeSpecification', () => runAnalyzeSpecification(context, wiring));
  register('impactgraph.reviewWorkingTree', () =>
    runReviewCommand(context, wiring, 'working-tree'),
  );
  register('impactgraph.reviewCurrentCommit', () => runReviewCommand(context, wiring, 'commit'));
  register('impactgraph.openReviewReport', () => runOpenReviewReport(wiring));
  register('impactgraph.approveImpactAnalysis', () => runApproveAnalysis());
  register('impactgraph.exportImplementationContext', () => runExportContext(context, wiring));
  register('impactgraph.showArchitecturalDependencies', () => runShowArchitecturalDependencies());
  register('impactgraph.showRequirementImpacts', () => runShowRequirementImpacts());
  register('impactgraph.analyzeSelection', () => runAnalyzeSelection(context, wiring));
  register('impactgraph.openAiAuditLog', () => runOpenAiAuditLog());
  context.subscriptions.push(
    vscode.commands.registerCommand('impactgraph.revealNode', (nodeId: string, path?: string) =>
      runRevealNode(nodeId, path),
    ),
  );
  register('impactgraph.filterImpacts', () => runFilterImpacts(wiring.impactTree));
  register('impactgraph.clearImpactFilters', () => runClearImpactFilters(wiring.impactTree));
  register('impactgraph.addManualImpact', () => runAddManualImpact());
  registerPanelCommands(context, wiring);
  registerCorrectionCommands(context, wiring);
  context.subscriptions.push(
    vscode.commands.registerCommand('impactgraph.acceptImpact', (node: ImpactTreeNode) =>
      runImpactDecision(node, 'accepted'),
    ),
    vscode.commands.registerCommand('impactgraph.rejectImpact', (node: ImpactTreeNode) =>
      runImpactDecision(node, 'rejected'),
    ),
  );
};
