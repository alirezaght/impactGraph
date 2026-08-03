import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { indexDatabasePath } from '@impactgraph/persistence';
import { approveAnalysis, listAnalyses } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { diagnoseIndexWorker } from './index-worker.js';
import {
  activateExtension,
  delay,
  dismissNotifications,
  fireCommand,
  waitFor,
  workspaceRoot,
} from './support.js';

// The suites share one window and one workspace, so the workflow steps are memoized here rather
// than repeated: whichever suite needs an indexed workspace first pays for it, the rest observe
// the same state. Every step drives the real §19 command — the engine API is used only to set up
// preconditions the shell cannot reach headlessly (approval is QuickPick + modal gated).

/** Mirrors the "deal filtering (§46 milestone case)" sample in packages/test-kit. */
export const SPEC_FILE_NAME = 'impactgraph-integration-spec.md';
export const SPEC_TEXT =
  '# Deal filtering\n\nDealService must filter expired deals from search results.\n';

const done = { initialized: false, indexed: false, analyzed: false, approved: false };

export const ensureInitialized = async (): Promise<string> => {
  const root = workspaceRoot();
  if (done.initialized) {
    return root;
  }
  await activateExtension();
  // `Initialize Workspace` ends by awaiting a notification with a "Reindex Now" action, which
  // nobody dismisses headlessly — fire it and wait on the scaffold it writes first.
  fireCommand('impactgraph.initializeWorkspace');
  await waitFor('.impactgraph/config.yml to be scaffolded', () =>
    existsSync(join(root, '.impactgraph', 'config.yml')),
  );
  await dismissNotifications();
  done.initialized = true;
  return root;
};

export const ensureIndexed = async (): Promise<string> => {
  const root = await ensureInitialized();
  if (done.indexed) {
    return root;
  }
  await vscode.commands.executeCommand('impactgraph.reindexWorkspace');
  await dismissNotifications();
  await delay(500);
  if (!existsSync(indexDatabasePath(root))) {
    // `Reindex Workspace` reports worker failures to the OutputChannel, which no API can read
    // back. Re-running the same worker with the same entry point turns "the index never
    // appeared" into the actual reason (a missing native module, a spawn failure, …).
    throw new Error(`Reindex Workspace produced no index — ${await diagnoseIndexWorker(root)}`);
  }
  done.indexed = true;
  return root;
};

/**
 * `Analyze Specification` picks the active Markdown editor before it offers a QuickPick, so
 * opening the spec is what makes the command run unattended.
 */
export const openSpecificationEditor = async (root: string): Promise<vscode.Uri> => {
  const uri = vscode.Uri.file(join(root, SPEC_FILE_NAME));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(SPEC_TEXT));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
  assert.equal(vscode.window.activeTextEditor?.document.languageId, 'markdown');
  return uri;
};

export const ensureAnalyzed = async (): Promise<string> => {
  const root = await ensureIndexed();
  if (done.analyzed) {
    return root;
  }
  await openSpecificationEditor(root);
  await vscode.commands.executeCommand('impactgraph.analyzeSpecification');
  await dismissNotifications();
  done.analyzed = true;
  return root;
};

export const latestAnalysisId = async (root: string): Promise<string> => {
  const analyses = await listAnalyses(root);
  if (!analyses.ok) {
    throw new Error(`listAnalyses failed: ${analyses.error.message}`);
  }
  const latest = analyses.value.at(-1);
  if (latest === undefined) {
    throw new Error('Analyze Specification produced no analysis artifact');
  }
  return latest.id;
};

/**
 * Review needs an approved baseline (§40.3). Approval in the shell is a QuickPick plus a modal
 * confirmation, neither of which a headless run can answer, so the precondition is set through
 * the engine — the review command itself is still exercised through the shell.
 */
export const ensureApproved = async (): Promise<string> => {
  const root = await ensureAnalyzed();
  if (done.approved) {
    return root;
  }
  const approved = await approveAnalysis(root, await latestAnalysisId(root));
  if (!approved.ok) {
    throw new Error(`approveAnalysis failed: ${approved.error.message}`);
  }
  done.approved = true;
  return root;
};
