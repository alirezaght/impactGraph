import { specIdFor } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { dispatchWebviewMessage } from '../webview/handlers.js';
import { ImpactReviewPanel } from '../webview/panel.js';
import { PanelSession } from '../webview/session.js';
import { requireTrustedWorkspace } from '../workspace.js';

import type { HandlerWiring } from '../webview/handlers.js';
import type { WebviewMessage } from '@impactgraph/contracts';

// Story 9.1 — the §19 specification commands and the review-panel entry point. The shell only
// resolves what the user pointed at, opens the panel, and forwards intent (main skill §9).

const PROTOCOL_VERSION = 1;

/** Open (or reveal) the review panel and return its session. */
export const openReviewPanel = (wiring: HandlerWiring): PanelSession | undefined => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return undefined;
  }
  // The handler closes over the session that is created from the panel it produces; the holder
  // breaks that cycle without a mutable module-level variable.
  const holder: { current?: PanelSession } = {};
  const panel = ImpactReviewPanel.show(wiring.context, wiring.output, async (message) => {
    if (holder.current !== undefined) {
      await dispatchWebviewMessage(holder.current, wiring, message);
    }
  });
  const session = new PanelSession(
    { context: wiring.context, output: wiring.output, impactTree: wiring.impactTree },
    root,
    panel,
  );
  holder.current = session;
  session.pushSpecification(session.specificationState);
  session.pushGraph();
  return session;
};

const send = async (
  wiring: HandlerWiring,
  message: WebviewMessage,
): Promise<PanelSession | undefined> => {
  const session = openReviewPanel(wiring);
  if (session === undefined) {
    return undefined;
  }
  await dispatchWebviewMessage(session, wiring, message);
  return session;
};

/** §19 Import Specification — the editor selection when there is one, else the whole file. */
export const runImportSpecification = async (wiring: HandlerWiring): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: open the specification file (or select text) before importing.',
    );
    return;
  }
  const source = editor.selection.isEmpty ? 'current-file' : 'selection';
  await send(wiring, {
    protocolVersion: PROTOCOL_VERSION,
    type: 'webview/import-specification',
    payload: { source },
  });
};

const activeSpecificationDocument = (): vscode.TextDocument | undefined => {
  const document = vscode.window.activeTextEditor?.document;
  if (document === undefined || document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage(
      'ImpactGraph: open the specification file in an editor first.',
    );
    return undefined;
  }
  return document;
};

/** §19 Save Specification Version — persists version N+1 of the active document (append-only). */
export const runSaveSpecificationVersion = async (wiring: HandlerWiring): Promise<void> => {
  const document = activeSpecificationDocument();
  if (document === undefined) {
    return;
  }
  await send(wiring, {
    protocolVersion: PROTOCOL_VERSION,
    type: 'webview/save-specification-version',
    payload: {
      name: vscode.workspace.asRelativePath(document.uri),
      text: document.getText(),
    },
  });
};

const pickVersion = async (
  versions: readonly number[],
  title: string,
): Promise<number | undefined> => {
  const picked = await vscode.window.showQuickPick(
    versions.map((version) => ({ label: `v${String(version)}`, version })),
    { title },
  );
  return picked?.version;
};

/** §19 Compare Specification Versions — rendered by VS Code's diff editor. */
export const runCompareSpecificationVersions = async (wiring: HandlerWiring): Promise<void> => {
  const document = activeSpecificationDocument();
  if (document === undefined) {
    return;
  }
  const session = openReviewPanel(wiring);
  if (session === undefined) {
    return;
  }
  const specificationId = specIdFor(vscode.workspace.asRelativePath(document.uri));
  const state = await session.run(
    'ImpactGraph: loading specification versions',
    { op: 'spec-load', rootDir: session.rootDir, specificationId },
    session.schemas.specification,
  );
  if (state === undefined || state.availableVersions.length < 2) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: this specification has only one stored version — nothing to compare yet.',
    );
    return;
  }
  session.pushSpecification(state);
  const left = await pickVersion(state.availableVersions, 'Compare from which version?');
  const right =
    left === undefined ? undefined : await pickVersion(state.availableVersions, 'Compare to?');
  if (left === undefined || right === undefined) {
    return;
  }
  await dispatchWebviewMessage(session, wiring, {
    protocolVersion: PROTOCOL_VERSION,
    type: 'webview/compare-specification-versions',
    payload: { specificationId, left, right },
  });
};
