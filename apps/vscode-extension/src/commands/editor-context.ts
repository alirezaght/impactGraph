import {
  explainNode,
  findComponents,
  listAnalyses,
  loadAnalysis,
} from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { resolveSourcePath } from '../views/navigation.js';
import { requireTrustedWorkspace } from '../workspace.js';

import {
  bestFileHit,
  dependencyPickItems,
  impactPickItems,
  impactsTouching,
  nodeIdsForFile,
  selectionSpecName,
} from './editor-context-items.js';
import { runAnalyzeText } from './workflows.js';

import type { WorkflowWiring } from './workflows.js';

// Story 7.5 / §19 editor context-menu commands. Handlers stay thin: resolve the active
// editor, call an existing engine query, and present the projection — nothing is computed
// or decided in the shell.

interface EditorFileContext {
  readonly root: string;
  readonly relPath: string;
  readonly editor: vscode.TextEditor;
}

const activeFileContext = (): EditorFileContext | undefined => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('ImpactGraph: open a file in the editor first.');
    return undefined;
  }
  return { root, relPath: vscode.workspace.asRelativePath(editor.document.uri), editor };
};

const REINDEX_HINT = 'ImpactGraph: no index for this workspace yet — run "Reindex Workspace".';

const openNodeSource = async (root: string, nodeId: string): Promise<void> => {
  const target = await explainNode(root, nodeId);
  const absolute = target.ok ? resolveSourcePath(root, target.value.path) : undefined;
  if (absolute === undefined) {
    void vscode.window.showInformationMessage('ImpactGraph: this node has no source file.');
    return;
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absolute));
};

export const runShowArchitecturalDependencies = async (): Promise<void> => {
  const ctx = activeFileContext();
  if (ctx === undefined) {
    return;
  }
  const hits = await findComponents(ctx.root, ctx.relPath, 100);
  if (!hits.ok) {
    void vscode.window.showInformationMessage(REINDEX_HINT);
    return;
  }
  const node = bestFileHit(hits.value, ctx.relPath);
  if (node === undefined) {
    void vscode.window.showInformationMessage(
      `ImpactGraph: ${ctx.relPath} is not in the current graph — reindex to pick it up.`,
    );
    return;
  }
  const explained = await explainNode(ctx.root, node.nodeId);
  if (!explained.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${explained.error.message}`);
    return;
  }
  const items = dependencyPickItems(explained.value);
  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      `ImpactGraph: no recorded dependencies for ${node.name}.`,
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Architectural dependencies of ${node.name} (${String(items.length)})`,
    placeHolder: 'Select a dependency to open its source',
  });
  if (picked !== undefined) {
    await openNodeSource(ctx.root, picked.nodeId);
  }
};

export const runShowRequirementImpacts = async (): Promise<void> => {
  const ctx = activeFileContext();
  if (ctx === undefined) {
    return;
  }
  const analyses = await listAnalyses(ctx.root);
  const latest = analyses.ok ? analyses.value[0] : undefined;
  if (latest === undefined) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: no analysis yet — run "Analyze Specification" first.',
    );
    return;
  }
  const [analysis, hits] = await Promise.all([
    loadAnalysis(ctx.root, latest.id),
    findComponents(ctx.root, ctx.relPath, 100),
  ]);
  if (!analysis.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${analysis.error.message}`);
    return;
  }
  const fileNodeIds = hits.ok ? nodeIdsForFile(hits.value, ctx.relPath) : new Set<string>();
  const touching = impactsTouching(analysis.value.requirementImpacts, fileNodeIds);
  if (touching.length === 0) {
    void vscode.window.showInformationMessage(
      `ImpactGraph: no impacts in analysis ${latest.id} touch ${ctx.relPath}.`,
    );
    return;
  }
  await vscode.window.showQuickPick(impactPickItems(touching), {
    title: `Impacts touching ${ctx.relPath} — analysis ${latest.id} (${latest.status})`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
};

export const runAnalyzeSelection = async (
  context: vscode.ExtensionContext,
  wiring: WorkflowWiring,
): Promise<void> => {
  const ctx = activeFileContext();
  if (ctx === undefined) {
    return;
  }
  const selection = ctx.editor.selection;
  const rawText = ctx.editor.document.getText(selection);
  if (selection.isEmpty || rawText.trim().length === 0) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: select the specification text to analyze first.',
    );
    return;
  }
  await runAnalyzeText(context, wiring, {
    root: ctx.root,
    specName: selectionSpecName(ctx.relPath, selection.start.line + 1, selection.end.line + 1),
    rawText,
  });
};
