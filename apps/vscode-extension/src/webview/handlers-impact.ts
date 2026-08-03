import { recordImpactDecision } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { resolveSourcePath, toEditorSelection } from '../views/navigation.js';

import { buildEvidenceState, unavailableEvidence } from './evidence-model.js';

import type { PanelSession } from './session.js';
import type { WebviewMessage } from '@impactgraph/contracts';

// Story 9.3/9.5 — graph and evidence requests. Selection is answered with §18.5 evidence built
// from the analyze document plus `explain_node`; decisions go to the engine append-only and the
// panel only shows what the engine confirmed (the webview never marks an impact accepted).

type Message<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;

const decisionKey = (requirementId: string, nodeId: string): string =>
  `${requirementId}::${nodeId}`;

export const handleSelectNode = async (
  session: PanelSession,
  message: Message<'webview/select-node'>,
): Promise<void> => {
  const { nodeId, requirementId } = message.payload;
  session.pushEvidence({
    schemaVersion: 1,
    status: 'loading',
    target: { nodeId, name: nodeId },
    humanDecisions: [],
    warnings: [],
  });
  const explanation = await session.run(
    'ImpactGraph: loading evidence',
    { op: 'explain-node', rootDir: session.rootDir, nodeId },
    session.schemas.explanation,
  );
  const document = session.analysisDocument;
  if (explanation === undefined && document === undefined) {
    session.pushEvidence(
      unavailableEvidence(
        'No evidence available: this node is not in the current index and no analysis is loaded.',
      ),
    );
    return;
  }
  session.pushEvidence(
    buildEvidenceState({
      document,
      nodeId,
      ...(requirementId === undefined ? {} : { requirementId }),
      ...(explanation === undefined ? {} : { explanation }),
      decisions:
        requirementId === undefined ? [] : session.decisionsFor(decisionKey(requirementId, nodeId)),
    }),
  );
};

/** §40.3 accept/reject: recorded by the engine (append-only); the impact stays visible. */
export const handleDecision = async (
  session: PanelSession,
  message: Message<'webview/impact-decision'>,
): Promise<void> => {
  const { analysisId, requirementId, nodeId, decision, reason } = message.payload;
  const recorded = await recordImpactDecision({
    rootDir: session.rootDir,
    analysisId,
    requirementId,
    nodeId,
    decision,
    ...(reason === undefined ? {} : { reason }),
  });
  if (!recorded.ok) {
    session.pushEvidence(unavailableEvidence(`Decision not recorded — ${recorded.error.message}`));
    void vscode.window.showErrorMessage(`ImpactGraph: ${recorded.error.message}`);
    return;
  }
  session.recordDecision(decisionKey(requirementId, nodeId), {
    decision,
    ...(reason === undefined ? {} : { reason }),
    recordedAt: new Date().toISOString(),
  });
  await handleSelectNode(session, {
    protocolVersion: 1,
    type: 'webview/select-node',
    payload: { nodeId, analysisId, requirementId },
  });
};

/** §18.4 open source from a node; §40.4 reveals the declaration range when there is one. */
export const handleOpenSource = async (
  session: PanelSession,
  message: Message<'webview/open-source'>,
): Promise<void> => {
  const target = resolveSourcePath(session.rootDir, message.payload.path);
  if (target === undefined) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  const selection = toEditorSelection(message.payload.range);
  await vscode.window.showTextDocument(document, {
    preview: true,
    ...(selection === undefined
      ? {}
      : {
          selection: new vscode.Range(
            selection.startLine,
            selection.startColumn,
            selection.endLine,
            selection.endColumn,
          ),
        }),
  });
};
