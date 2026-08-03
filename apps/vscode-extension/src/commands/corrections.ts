import { applyConfigOperation, readConfigurationDocuments } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { isNodeItem } from '../views/architecture-sections.js';
import { requireTrustedWorkspace } from '../workspace.js';

import {
  assignToContextOperation,
  contextPickItems,
  correctionAppliedMessage,
  correctionGlob,
  markAsDomainOperation,
  NO_CONTEXTS_MESSAGE,
  relativeTo,
} from './correction-items.js';

import type { ArchitectureItem } from '../views/architecture-tree.js';
import type { ConfigOperationDto } from '@impactgraph/contracts';

// Story 8.2 / §19 — the three correction entry points: tree context menu and editor context menu.
// The shell stays thin: resolve the target path, ask the user, hand a structured operation to the
// engine (which mode-gates, validates, writes atomically and audits), refresh the tree.

/** A package node's path is its manifest; corrections apply to the directory that owns it. */
const globForItem = (item: ArchitectureItem): string | undefined => {
  // Section/context/note rows own no graph node; the §18.6 menus never offer themselves there
  // (`contextValue`), and a programmatic call still resolves to "no target" rather than guessing.
  if (!isNodeItem(item)) {
    return undefined;
  }
  const path = item.node.path;
  if (path === undefined) {
    return undefined;
  }
  if (item.kind !== 'package') {
    return correctionGlob(path, false);
  }
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return directory === '' ? '**' : correctionGlob(directory, true);
};

/** The correction target: the clicked tree item, else the active editor's file. */
const resolveTarget = (rootDir: string, item: ArchitectureItem | undefined): string | undefined => {
  if (item !== undefined) {
    return globForItem(item);
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active === undefined || active.scheme !== 'file') {
    return undefined;
  }
  const relative = relativeTo(rootDir, active.fsPath);
  return relative === undefined ? undefined : correctionGlob(relative, false);
};

const applyCorrection = async (
  rootDir: string,
  operation: ConfigOperationDto,
  glob: string,
  refresh: () => void,
): Promise<void> => {
  // The user invoking the command IS the approval (§Z11): the record is human-confirmed (§Z5).
  const applied = applyConfigOperation({ rootDir, operation, actor: { kind: 'user' } });
  if (!applied.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${applied.error.message}`);
    return;
  }
  refresh();
  await vscode.window.showInformationMessage(
    correctionAppliedMessage(operation.kind, glob, applied.value.rollbackId),
  );
};

interface CorrectionCommand {
  readonly item: ArchitectureItem | undefined;
  readonly refresh: () => void;
}

const NO_TARGET =
  'ImpactGraph: select a file or package in the Architecture view (or open a file in the workspace) first.';

export const runMarkAsDomainComponent = async ({
  item,
  refresh,
}: CorrectionCommand): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const glob = resolveTarget(root, item);
  if (glob === undefined) {
    void vscode.window.showInformationMessage(NO_TARGET);
    return;
  }
  await applyCorrection(root, markAsDomainOperation(glob), glob, refresh);
};

export const runAssignToContext = async ({ item, refresh }: CorrectionCommand): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const glob = resolveTarget(root, item);
  if (glob === undefined) {
    void vscode.window.showInformationMessage(NO_TARGET);
    return;
  }
  const documents = readConfigurationDocuments(root);
  if (!documents.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${documents.error.message}`);
    return;
  }
  const picks = contextPickItems(documents.value.architecture.contexts ?? []);
  if (picks.length === 0) {
    void vscode.window.showInformationMessage(NO_CONTEXTS_MESSAGE);
    return;
  }
  const picked = await vscode.window.showQuickPick(picks, {
    title: `Assign ${glob} to which bounded context? (§16)`,
  });
  if (picked === undefined) {
    return;
  }
  await applyCorrection(root, assignToContextOperation(glob, picked.label), glob, refresh);
};

export const runIgnorePath = async ({ item, refresh }: CorrectionCommand): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const glob = resolveTarget(root, item);
  if (glob === undefined) {
    void vscode.window.showInformationMessage(NO_TARGET);
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Ignore ${glob}? Matching files are excluded from indexing on the next reindex (§16, §40.1).`,
    { modal: true },
    'Ignore Path',
  );
  if (confirmed !== 'Ignore Path') {
    return;
  }
  await applyCorrection(
    root,
    {
      kind: 'add-ignore',
      glob,
      reason: 'ignored from the ImpactGraph architecture view (§16)',
    },
    glob,
    refresh,
  );
};
