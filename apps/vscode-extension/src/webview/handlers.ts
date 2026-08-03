import * as vscode from 'vscode';

import { handleDecision, handleOpenSource, handleSelectNode } from './handlers-impact.js';
import {
  handleAnalyze,
  handleCompare,
  handleImport,
  handleMutation,
  handleSave,
} from './handlers-spec.js';

import type { PanelSession } from './session.js';
import type { WorkflowWiring } from '../commands/workflows.js';
import type { WebviewMessage } from '@impactgraph/contracts';

// The single webview → host dispatch point. Messages arrive already Zod-validated (panel.ts);
// this file only routes intent to the handler that owns it. The routing is written as guarded
// branches rather than one switch so each family stays independently readable.

export interface HandlerWiring extends WorkflowWiring {
  readonly context: vscode.ExtensionContext;
}

const MUTATIONS = [
  'webview/answer-question',
  'webview/dismiss-question',
  'webview/requirement-decision',
  'webview/edit-requirement',
] as const;

type MutationType = (typeof MUTATIONS)[number];

const isMutation = (
  message: WebviewMessage,
): message is Extract<WebviewMessage, { type: MutationType }> =>
  (MUTATIONS as readonly string[]).includes(message.type);

const refresh = (session: PanelSession): void => {
  session.pushSpecification(session.specificationState);
  session.pushGraph();
};

/** §18.2 specification requests; returns false when the message is not a specification one. */
const dispatchSpecification = async (
  session: PanelSession,
  wiring: HandlerWiring,
  message: WebviewMessage,
): Promise<boolean> => {
  if (message.type === 'webview/import-specification') {
    handleImport(session, message);
    return true;
  }
  if (message.type === 'webview/analyze-specification') {
    await handleAnalyze(session, wiring, message);
    return true;
  }
  if (message.type === 'webview/save-specification-version') {
    await handleSave(session, wiring.context, message);
    return true;
  }
  if (message.type === 'webview/compare-specification-versions') {
    await handleCompare(session, message);
    return true;
  }
  if (isMutation(message)) {
    await handleMutation(session, message);
    return true;
  }
  return false;
};

/** §18.4/§18.5 graph, evidence and decision requests. */
const dispatchImpact = async (session: PanelSession, message: WebviewMessage): Promise<void> => {
  if (message.type === 'webview/select-node') {
    await handleSelectNode(session, message);
    return;
  }
  if (message.type === 'webview/impact-decision') {
    await handleDecision(session, message);
    return;
  }
  if (message.type === 'webview/open-source') {
    await handleOpenSource(session, message);
    return;
  }
  if (message.type === 'webview/add-manual-impact') {
    // §18.4 "add missing impact" reuses the engine-validated node picker (Story 9.4): a manual
    // impact must reference an existing graph node, so a free-text component name is impossible.
    await vscode.commands.executeCommand('impactgraph.addManualImpact');
  }
};

export const dispatchWebviewMessage = async (
  session: PanelSession,
  wiring: HandlerWiring,
  message: WebviewMessage,
): Promise<void> => {
  if (message.type === 'webview/ready' || message.type === 'webview/refresh') {
    refresh(session);
    return;
  }
  if (await dispatchSpecification(session, wiring, message)) {
    return;
  }
  await dispatchImpact(session, message);
};
