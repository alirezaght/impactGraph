import { existsSync } from 'node:fs';

import { createKnowledgeGraph } from '@impactgraph/domain';
import { indexDatabasePath, openSqliteIndexStore } from '@impactgraph/persistence';
import { contextsForGraph } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { workspaceRoot } from '../workspace.js';

import {
  componentsInContext,
  containedChildren,
  hasContainedChildren,
  isNodeItem,
  sectionChildren,
  sectionItems,
} from './architecture-sections.js';
import { resolveSourcePath } from './navigation.js';

import type {
  ArchitectureGroupItem,
  ArchitectureItem,
  ArchitectureNodeItem,
} from './architecture-sections.js';
import type { KnowledgeGraph } from '@impactgraph/domain';

// Story 7.4 — architecture tree: a pure projection of the persisted graph (no computation in the
// provider beyond grouping, which lives in `architecture-sections.ts`). §18.6 sections are the
// top level; provenance is shown as a text label, never colour alone (§37).
//
// `contextValue` is load-bearing: the Epic 08 correction menus key off `package`/`file`/`symbol`.
// Section, context and note rows deliberately carry different values so those menus never appear
// on a row that owns no path.

export type { ArchitectureItem, ArchitectureNodeItem } from './architecture-sections.js';

const PROVENANCE_LABEL: Readonly<Record<string, string>> = {
  'static-analysis': 'fact',
  configuration: 'fact',
  'git-history': 'fact',
  'framework-convention': 'convention',
  'llm-inferred': 'inferred',
  'human-confirmed': 'confirmed',
};

interface LoadedGraph {
  readonly graph: KnowledgeGraph;
  /** §Z5 effective bounded context per node id; absent = unassigned, never guessed. */
  readonly contexts: ReadonlyMap<string, string>;
}

const loadGraph = async (): Promise<LoadedGraph | undefined> => {
  const root = workspaceRoot();
  if (root === undefined) {
    return undefined;
  }
  const dbPath = indexDatabasePath(root);
  if (!existsSync(dbPath)) {
    return undefined;
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return undefined;
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    if (!current.ok || current.value === undefined) {
      return undefined;
    }
    const stored = await store.value.loadGraph(current.value);
    if (!stored.ok) {
      return undefined;
    }
    const graph = createKnowledgeGraph(stored.value.nodes, stored.value.edges);
    return graph.ok
      ? { graph: graph.value, contexts: contextsForGraph(root, graph.value) }
      : undefined;
  } finally {
    await store.value.close();
  }
};

/**
 * Sections open (they are the map of the view); contexts stay collapsed so a repository with many
 * contexts does not resolve every component list on first paint (§33 progressive disclosure);
 * notes are leaves.
 */
const COLLAPSIBLE: Readonly<
  Record<ArchitectureGroupItem['kind'], vscode.TreeItemCollapsibleState>
> = {
  section: vscode.TreeItemCollapsibleState.Expanded,
  context: vscode.TreeItemCollapsibleState.Collapsed,
  note: vscode.TreeItemCollapsibleState.None,
};

const groupItem = (element: ArchitectureGroupItem): vscode.TreeItem => {
  const item = new vscode.TreeItem(element.label, COLLAPSIBLE[element.kind]);
  item.id = `${element.kind}:${element.id}`;
  item.description = element.detail;
  // Never `package`/`file`/`symbol`: the §16 correction menus must not offer themselves here.
  item.contextValue = `architecture-${element.kind}`;
  item.accessibilityInformation = { label: `${element.label}, ${element.detail}` };
  return item;
};

export class ArchitectureTreeProvider implements vscode.TreeDataProvider<ArchitectureItem> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private loaded: LoadedGraph | undefined;

  public refresh(): void {
    this.loaded = undefined;
    this.changed.fire(undefined);
  }

  public getTreeItem(element: ArchitectureItem): vscode.TreeItem {
    return isNodeItem(element) ? this.nodeItem(element) : groupItem(element);
  }

  private collapsibleFor(element: ArchitectureNodeItem): vscode.TreeItemCollapsibleState {
    if (element.kind === 'symbol') {
      return vscode.TreeItemCollapsibleState.None;
    }
    const graph = this.loaded?.graph;
    // Unknown graph → assume expandable; an empty expander is better than a hidden subtree.
    return graph === undefined || hasContainedChildren(graph, element)
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
  }

  private nodeItem(element: ArchitectureNodeItem): vscode.TreeItem {
    const { node } = element;
    const item = new vscode.TreeItem(node.name, this.collapsibleFor(element));
    const provenance = PROVENANCE_LABEL[node.knowledge.provenance] ?? node.knowledge.provenance;
    item.description = `${node.type} · ${provenance}`;
    item.tooltip = `${node.name}\n${node.type} (${node.category})\nprovenance: ${node.knowledge.provenance}`;
    // A component appears under both Contexts and Components; ids must stay unique per row.
    item.id = `${element.kind}:${node.id}`;
    // §16 corrections are offered on things that have a path (packages and files), not symbols.
    item.contextValue = element.kind;
    // Accessible label carries the provenance in text (§37).
    item.accessibilityInformation = { label: `${node.name}, ${node.type}, ${provenance}` };
    const command = this.commandFor(element);
    if (command !== undefined) {
      item.command = command;
    }
    return item;
  }

  private commandFor(element: ArchitectureNodeItem): vscode.Command | undefined {
    const { node } = element;
    const target =
      element.kind === 'package' ? undefined : resolveSourcePath(workspaceRoot(), node.path);
    if (target === undefined) {
      return undefined;
    }
    // §40.4: symbols reveal at their declaration range (resolved lazily from evidence);
    // files have no single range worth revealing, so they open at the top.
    return element.kind === 'symbol'
      ? {
          command: 'impactgraph.revealNode',
          title: 'Reveal Declaration',
          arguments: [node.id, node.path],
        }
      : { command: 'vscode.open', title: 'Open Source', arguments: [vscode.Uri.file(target)] };
  }

  public async getChildren(element?: ArchitectureItem): Promise<ArchitectureItem[]> {
    this.loaded ??= await loadGraph();
    const loaded = this.loaded;
    if (loaded === undefined) {
      return [];
    }
    if (element === undefined) {
      return sectionItems();
    }
    if (isNodeItem(element)) {
      return containedChildren(loaded.graph, element);
    }
    if (element.kind === 'section') {
      return sectionChildren(loaded.graph, loaded.contexts, element.id);
    }
    if (element.kind === 'context') {
      return componentsInContext(loaded.graph, loaded.contexts, element.id);
    }
    return [];
  }
}
