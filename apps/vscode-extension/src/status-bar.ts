import { existsSync } from 'node:fs';

import {
  indexDatabasePath,
  isWorkspaceInitialized,
  openSqliteIndexStore,
  readWorkspaceConfig,
} from '@impactgraph/persistence';
import * as vscode from 'vscode';

import { workspaceRoot } from './workspace.js';

// Privacy mode is always visible and never changed silently (PRD §9, Story 7.1).

export interface StatusBar {
  readonly item: vscode.StatusBarItem;
  refresh(): Promise<void>;
}

const readPrivacyMode = (root: string): string => {
  const config = readWorkspaceConfig(root);
  return config.ok ? (config.value?.privacyMode ?? 'selected-snippets') : 'selected-snippets';
};

/**
 * Read-only status probe. It must NEVER create anything: opening the store would scaffold
 * `.impactgraph/cache/` in a workspace the user never initialized — and, because the status bar
 * refreshes on activation, in an UNTRUSTED workspace too (PRD §33 activation does no work,
 * §35 untrusted workspaces are not written to). Found by the §42.4 electron suite.
 */
const readIndexState = async (root: string): Promise<string> => {
  if (!vscode.workspace.isTrusted) {
    return 'workspace not trusted';
  }
  const dbPath = indexDatabasePath(root);
  if (!isWorkspaceInitialized(root) || !existsSync(dbPath)) {
    return 'not indexed';
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return 'index unavailable';
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    return current.ok && current.value !== undefined ? 'indexed' : 'not indexed';
  } finally {
    await store.value.close();
  }
};

export const createStatusBar = (): StatusBar => {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.name = 'ImpactGraph';
  item.command = 'impactgraph.configurePrivacy';
  item.text = '$(type-hierarchy-sub) ImpactGraph';
  item.show();
  return {
    item,
    refresh: async (): Promise<void> => {
      const root = workspaceRoot();
      if (root === undefined) {
        item.text = '$(type-hierarchy-sub) ImpactGraph';
        item.tooltip = 'ImpactGraph: no workspace open';
        return;
      }
      const privacy = readPrivacyMode(root);
      const index = await readIndexState(root);
      item.text = `$(type-hierarchy-sub) ImpactGraph: ${privacy}`;
      item.tooltip = `Privacy mode: ${privacy} (click to change) — ${index}`;
    },
  };
};
