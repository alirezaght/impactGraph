import {
  detectConfigDrift,
  listLearningProposals,
  readLastRunWarnings,
} from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { workspaceRoot } from '../workspace.js';

import { buildIssueItems } from './issues-items.js';
import { accessibilityLabel } from './navigation.js';

import type { IssueTreeNode } from './issues-items.js';

// The Issues tree (§18.1) — a projection over drift, learning proposals, and index warnings.
// Data loads lazily on first expansion and on refresh(); an unindexed workspace shows an
// explanatory node instead of an error.

export class IssuesTreeProvider implements vscode.TreeDataProvider<IssueTreeNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private roots: readonly IssueTreeNode[] | undefined;

  public refresh(): void {
    this.roots = undefined;
    this.changed.fire(undefined);
  }

  public getTreeItem(node: IssueTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    if (node.description !== undefined) {
      item.description = node.description;
    }
    item.tooltip = node.tooltip ?? node.label;
    item.contextValue = node.kind;
    // §37: section counts and issue details are announced as text.
    item.accessibilityInformation = { label: accessibilityLabel(node.label, node.description) };
    return item;
  }

  public async getChildren(node?: IssueTreeNode): Promise<IssueTreeNode[]> {
    if (node !== undefined) {
      return [...node.children];
    }
    if (this.roots === undefined) {
      this.roots = await this.load();
    }
    return [...this.roots];
  }

  private async load(): Promise<IssueTreeNode[]> {
    const root = workspaceRoot();
    if (root === undefined) {
      return [{ kind: 'empty', label: 'No workspace folder open.', children: [] }];
    }
    const drift = await detectConfigDrift(root);
    const proposals = listLearningProposals(root);
    const warnings = await readLastRunWarnings(root);
    if (!drift.ok && !warnings.ok) {
      return [
        {
          kind: 'empty',
          label: 'No index yet — run "Reindex Workspace" to populate issues.',
          children: [],
        },
      ];
    }
    return buildIssueItems({
      drift: drift.ok ? drift.value : undefined,
      proposals: proposals.ok ? proposals.value : [],
      indexWarnings: warnings.ok ? warnings.value : [],
    });
  }
}
