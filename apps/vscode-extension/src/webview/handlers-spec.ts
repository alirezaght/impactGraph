import { specIdFor } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { resolveSendKey, runAnalyzeText } from '../commands/workflows.js';

import type { PanelSession } from './session.js';
import type { WorkflowWiring } from '../commands/workflows.js';
import type { SpecificationPanelStateDto, WebviewMessage } from '@impactgraph/contracts';

// Story 9.1 — §18.2 specification panel requests. The shell reads the editor, asks the engine,
// and pushes the result back; it never extracts requirements or decides anything itself.

type Message<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;

const withDraft = (
  state: SpecificationPanelStateDto,
  draft: { name: string; text: string },
): SpecificationPanelStateDto => ({ ...state, draft });

/** §18.2 import: the current Markdown file, or exactly the editor selection. */
export const handleImport = (
  session: PanelSession,
  message: Message<'webview/import-specification'>,
): void => {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    session.pushSpecification({
      ...session.specificationState,
      warnings: ['No active editor to import from — open the specification file first.'],
    });
    return;
  }
  const selection = editor.selection;
  const wantsSelection = message.payload.source === 'selection';
  if (wantsSelection && selection.isEmpty) {
    session.pushSpecification({
      ...session.specificationState,
      warnings: ['Nothing selected — select the specification text, or import the whole file.'],
    });
    return;
  }
  const text = wantsSelection ? editor.document.getText(selection) : editor.document.getText();
  const name = vscode.workspace.asRelativePath(editor.document.uri);
  session.pushSpecification(
    withDraft(session.specificationState, {
      name: wantsSelection ? `${name} (selection)` : name,
      text,
    }),
  );
};

const loadState = async (session: PanelSession, specificationId: string): Promise<void> => {
  const state = await session.run(
    'ImpactGraph: loading specification',
    { op: 'spec-load', rootDir: session.rootDir, specificationId },
    session.schemas.specification,
  );
  if (state !== undefined) {
    session.pushSpecification(state);
  }
};

/** §19 Analyze Specification, driven from the panel editor: same consent + engine path. */
export const handleAnalyze = async (
  session: PanelSession,
  wiring: WorkflowWiring & { context: vscode.ExtensionContext },
  message: Message<'webview/analyze-specification'>,
): Promise<void> => {
  await runAnalyzeText(wiring.context, wiring, {
    root: session.rootDir,
    specName: message.payload.name,
    rawText: message.payload.text,
  });
  session.pushGraph();
  await loadState(session, specIdFor(message.payload.name));
};

/** §19 Save Specification Version: persists version N+1 when the text changed (append-only). */
export const handleSave = async (
  session: PanelSession,
  context: vscode.ExtensionContext,
  message: Message<'webview/save-specification-version'>,
): Promise<void> => {
  const consent = await resolveSendKey(context, session.rootDir);
  if (consent.aborted) {
    return;
  }
  const state = await session.run(
    'ImpactGraph: saving specification version',
    {
      op: 'spec-submit',
      rootDir: session.rootDir,
      specName: message.payload.name,
      rawText: message.payload.text,
      ...(consent.apiKey === undefined ? {} : { apiKey: consent.apiKey }),
    },
    session.schemas.specification,
  );
  if (state !== undefined) {
    session.pushSpecification(state);
  }
};

/** §19 Compare Specification Versions — rendered by VS Code's own diff editor. */
export const handleCompare = async (
  session: PanelSession,
  message: Message<'webview/compare-specification-versions'>,
): Promise<void> => {
  const { specificationId, left, right } = message.payload;
  const [before, after] = await Promise.all([
    session.run(
      `ImpactGraph: loading specification v${String(left)}`,
      { op: 'spec-load', rootDir: session.rootDir, specificationId, version: left },
      session.schemas.specification,
    ),
    session.run(
      `ImpactGraph: loading specification v${String(right)}`,
      { op: 'spec-load', rootDir: session.rootDir, specificationId, version: right },
      session.schemas.specification,
    ),
  ]);
  if (before?.specification === undefined || after?.specification === undefined) {
    return;
  }
  const leftDoc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: before.specification.rawText,
  });
  const rightDoc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: after.specification.rawText,
  });
  await vscode.commands.executeCommand(
    'vscode.diff',
    leftDoc.uri,
    rightDoc.uri,
    `${specificationId}: v${String(left)} ↔ v${String(right)}`,
  );
};

type MutationMessage =
  | Message<'webview/answer-question'>
  | Message<'webview/dismiss-question'>
  | Message<'webview/requirement-decision'>
  | Message<'webview/edit-requirement'>;

const mutationSpec = (
  message: MutationMessage,
): {
  action: 'confirm' | 'reject' | 'edit' | 'dismiss' | 'answer';
  requirementId?: string;
  questionId?: string;
  statement?: string;
  answer?: string;
} => {
  switch (message.type) {
    case 'webview/answer-question':
      return {
        action: 'answer',
        questionId: message.payload.questionId,
        answer: message.payload.answer,
      };
    case 'webview/dismiss-question':
      return { action: 'dismiss', questionId: message.payload.questionId };
    case 'webview/edit-requirement':
      return {
        action: 'edit',
        requirementId: message.payload.requirementId,
        statement: message.payload.statement,
      };
    case 'webview/requirement-decision':
      return {
        action: message.payload.decision === 'confirmed' ? 'confirm' : 'reject',
        requirementId: message.payload.requirementId,
      };
  }
};

/** Requirement/question mutations: engine applies them, version N+1 comes back (§40.2). */
export const handleMutation = async (
  session: PanelSession,
  message: MutationMessage,
): Promise<void> => {
  const state = await session.run(
    'ImpactGraph: updating specification',
    {
      op: 'spec-mutate',
      rootDir: session.rootDir,
      specificationId: message.payload.specificationId,
      ...mutationSpec(message),
    },
    session.schemas.specification,
  );
  session.pushSpecification(state ?? session.specificationState);
};
