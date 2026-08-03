import * as vscode from 'vscode';

import { buildImpactItems, impactHeadline } from './impact-items.js';
import { accessibilityLabel, resolveSourcePath } from './navigation.js';

import type { ImpactTreeNode, ImpactViewOptions } from './impact-items.js';
import type { CliAnalyzeOutput } from '@impactgraph/contracts';

// Story 9.2 — the Current Impact tree, a projection of the analyze document. No computation
// here beyond mapping (§18.3); decisions are commands, never tree-side mutations.

export class ImpactTreeProvider implements vscode.TreeDataProvider<ImpactTreeNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private roots: readonly ImpactTreeNode[] = [];
  private output: CliAnalyzeOutput | undefined;

  private options: ImpactViewOptions = {};

  public setAnalysis(rootDir: string, output: CliAnalyzeOutput): void {
    this.rootDir = rootDir;
    this.output = output;
    this.roots = buildImpactItems(output, this.options);
    this.changed.fire(undefined);
  }

  /** Story 9.2: filters + grouping switch — reprojects the same document, no recomputation. */
  public setViewOptions(options: ImpactViewOptions): void {
    this.options = options;
    if (this.output !== undefined) {
      this.roots = buildImpactItems(this.output, this.options);
    }
    this.changed.fire(undefined);
  }

  public get current(): CliAnalyzeOutput | undefined {
    return this.output;
  }

  public headline(): string | undefined {
    return this.output === undefined ? undefined : impactHeadline(this.output);
  }

  private rootDir: string | undefined;

  public getTreeItem(node: ImpactTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length > 0
        ? node.kind === 'requirement'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
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
        title: 'Open evidence',
        arguments: [vscode.Uri.file(target)],
      };
    }
    return item;
  }

  public getChildren(node?: ImpactTreeNode): ImpactTreeNode[] {
    return [...(node === undefined ? this.roots : node.children)];
  }
}
