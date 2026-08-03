import * as vscode from 'vscode';

import { accessibilityLabel, resolveSourcePath } from './navigation.js';
import { buildReviewItems } from './review-items.js';

import type { ReviewTreeNode } from './review-items.js';
import type { CliReviewOutput } from '@impactgraph/contracts';

// Story 11.4 / §18.7 — the Review tree, a projection of the review document.

export class ReviewTreeProvider implements vscode.TreeDataProvider<ReviewTreeNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private roots: readonly ReviewTreeNode[] = [];
  private report: CliReviewOutput | undefined;
  private rootDir: string | undefined;

  public setReport(rootDir: string, report: CliReviewOutput): void {
    this.rootDir = rootDir;
    this.report = report;
    this.roots = buildReviewItems(report);
    this.changed.fire(undefined);
  }

  public get current(): CliReviewOutput | undefined {
    return this.report;
  }

  public getTreeItem(node: ReviewTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    if (node.description !== undefined) {
      item.description = node.description;
    }
    item.tooltip = node.tooltip ?? node.label;
    item.contextValue = node.kind;
    // §37: label + badge announced as text; navigation resolved by the pure helper (7.5).
    item.accessibilityInformation = { label: accessibilityLabel(node.label, node.description) };
    const target = resolveSourcePath(this.rootDir, node.filePath);
    if (target !== undefined) {
      item.command = {
        command: 'vscode.open',
        title: 'Open file',
        arguments: [vscode.Uri.file(target)],
      };
    }
    return item;
  }

  public getChildren(node?: ReviewTreeNode): ReviewTreeNode[] {
    return [...(node === undefined ? this.roots : node.children)];
  }
}
