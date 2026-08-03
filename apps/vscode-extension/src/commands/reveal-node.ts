import { explainNode } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { resolveSourcePath, toEditorSelection } from '../views/navigation.js';
import { workspaceRoot } from '../workspace.js';

// Story 7.5 / §40.4 — reveal a graph node at its declaration. Ranges live on evidence
// records, not on nodes, so they are resolved lazily on selection (one engine call per click)
// rather than eagerly for every tree item. No range → the file still opens, at the top.

/** The evidence range that best identifies a node: a range on the node's own file. */
const declarationRange = (
  explanation: Awaited<ReturnType<typeof explainNode>>,
  path: string | undefined,
): { startLine: number; startColumn: number; endLine: number; endColumn: number } | undefined => {
  if (!explanation.ok) {
    return undefined;
  }
  const onOwnFile = explanation.value.knowledge.evidence.find(
    (entry) => entry.range !== undefined && (path === undefined || entry.source === path),
  );
  return onOwnFile?.range;
};

export const runRevealNode = async (nodeId: string, path?: string): Promise<void> => {
  const root = workspaceRoot();
  const target = resolveSourcePath(root, path);
  if (root === undefined || target === undefined) {
    return;
  }
  const explanation = await explainNode(root, nodeId);
  const selection = toEditorSelection(declarationRange(explanation, path));
  const uri = vscode.Uri.file(target);
  if (selection === undefined) {
    await vscode.commands.executeCommand('vscode.open', uri);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri, {
    selection: new vscode.Range(
      selection.startLine,
      selection.startColumn,
      selection.endLine,
      selection.endColumn,
    ),
  });
};
