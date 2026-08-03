import { join } from 'node:path';

import {
  cliAnalyzeOutputSchema,
  cliExportOutputSchema,
  cliReviewOutputSchema,
} from '@impactgraph/contracts';
import { readWorkspaceConfig } from '@impactgraph/persistence';
import { buildReviewMarkdown } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { startEngineJob } from '../engine/engine-client.js';
import { requireTrustedWorkspace } from '../workspace.js';

import { API_KEY_SECRET } from './provider-config.js';

import type { EngineJobOutcome } from '../engine/engine-client.js';
import type { EngineJobSpec } from '../engine/protocol.js';
import type { ImpactTreeProvider } from '../views/impact-tree.js';
import type { ReviewTreeProvider } from '../views/review-tree.js';
import type { ZodType } from 'zod';

// §19 workflow commands. The shell maps VS Code surfaces to engine jobs running in the
// bundled worker process (never in the host, §32/§33), with real cancellation, and validates
// every worker payload against the contract before rendering (ADR-0009).

export interface WorkflowWiring {
  readonly output: vscode.OutputChannel;
  readonly impactTree: ImpactTreeProvider;
  readonly reviewTree: ReviewTreeProvider;
}

const runJob = async (
  context: vscode.ExtensionContext,
  title: string,
  request: EngineJobSpec,
): Promise<EngineJobOutcome> =>
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const handle = startEngineJob(
        join(context.extensionPath, 'dist', 'engine-worker.cjs'),
        request,
      );
      token.onCancellationRequested(() => {
        handle.cancel();
      });
      return handle.outcome;
    },
  );

const validated = <T>(
  outcome: EngineJobOutcome,
  schema: ZodType<T>,
  output: vscode.OutputChannel,
): T | undefined => {
  if (outcome.kind === 'cancelled') {
    return undefined;
  }
  if (outcome.kind === 'failed') {
    output.appendLine(`[engine] ${outcome.error.category}: ${outcome.error.message}`);
    void vscode.window.showErrorMessage(`ImpactGraph: ${outcome.error.message}`);
    return undefined;
  }
  const parsed = schema.safeParse(outcome.value);
  if (!parsed.success) {
    void vscode.window.showErrorMessage(
      'ImpactGraph: engine result failed contract validation — see the output channel.',
    );
    output.appendLine(`[engine] contract violation: ${parsed.error.issues[0]?.message ?? '?'}`);
    return undefined;
  }
  return parsed.data;
};

const pickSpecificationFile = async (): Promise<vscode.Uri | undefined> => {
  const active = vscode.window.activeTextEditor?.document;
  if (active !== undefined && active.languageId === 'markdown' && active.uri.scheme === 'file') {
    return active.uri;
  }
  const candidates = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**', 25);
  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { title: 'Select the specification (Markdown)' },
  );
  return picked?.uri;
};

type SendConsent = 'send' | 'deterministic' | 'abort';

/**
 * §35 consent before an external send: the worker cannot prompt, so the host confirms the
 * outbound flow up front (provider + mode). Blocking modes short-circuit in the guard anyway.
 */
const wouldSendExternally = (root: string): string | undefined => {
  const config = readWorkspaceConfig(root);
  if (!config.ok) {
    return undefined;
  }
  const strategy = config.value?.provider?.strategy;
  const mode = config.value?.privacyMode ?? 'selected-snippets';
  const externalConfigured = strategy === 'anthropic' || strategy === 'openai-compatible';
  const modeAllowsExternal = mode !== 'local-only' && mode !== 'external-agent';
  return externalConfigured && modeAllowsExternal
    ? `'${strategy}' under privacy mode '${mode}'`
    : undefined;
};

const confirmExternalSend = async (root: string): Promise<SendConsent> => {
  const destination = wouldSendExternally(root);
  if (destination === undefined) {
    return 'send'; // nothing will leave the machine — the guard blocks external calls anyway
  }
  const choice = await vscode.window.showWarningMessage(
    `This analysis will send the specification text (secrets redacted) to ${destination}. The send is recorded in .impactgraph/artifacts/ai-audit.jsonl.`,
    { modal: true },
    'Send',
    'Analyze Deterministically',
  );
  if (choice === undefined) {
    return 'abort';
  }
  return choice === 'Send' ? 'send' : 'deterministic';
};

/**
 * §35 consent + key resolution, shared by analysis and by specification submission from the
 * review panel. `aborted` means the user cancelled; a missing key means deterministic-only.
 */
export const resolveSendKey = async (
  context: vscode.ExtensionContext,
  root: string,
): Promise<{ readonly aborted: boolean; readonly apiKey?: string | undefined }> => {
  const consent = await confirmExternalSend(root);
  if (consent === 'abort') {
    return { aborted: true };
  }
  if (consent === 'deterministic') {
    return { aborted: false };
  }
  const apiKey = (await context.secrets.get(API_KEY_SECRET)) ?? undefined;
  return { aborted: false, apiKey };
};

/**
 * Shared analyze pipeline (§19): consent → engine job → contract validation → impact tree.
 * Used by "Analyze Specification" (whole file) and "Analyze Selection" (editor selection).
 */
export const runAnalyzeText = async (
  context: vscode.ExtensionContext,
  wiring: WorkflowWiring,
  spec: { readonly root: string; readonly specName: string; readonly rawText: string },
): Promise<void> => {
  const consent = await resolveSendKey(context, spec.root);
  if (consent.aborted) {
    return;
  }
  const apiKey = consent.apiKey;
  const outcome = await runJob(context, 'ImpactGraph: analyzing specification', {
    op: 'analyze',
    rootDir: spec.root,
    specName: spec.specName,
    rawText: spec.rawText,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
  const doc = validated(outcome, cliAnalyzeOutputSchema, wiring.output);
  if (doc === undefined) {
    return;
  }
  wiring.impactTree.setAnalysis(spec.root, doc);
  void vscode.window.showInformationMessage(
    `ImpactGraph: ${String(doc.analysis.impactCount)} impacts predicted (analysis ${doc.analysis.id}). Review them in the Current Impact view, then approve.`,
  );
};

export const runAnalyzeSpecification = async (
  context: vscode.ExtensionContext,
  wiring: WorkflowWiring,
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const specUri = await pickSpecificationFile();
  if (specUri === undefined) {
    return;
  }
  const rawText = new TextDecoder().decode(await vscode.workspace.fs.readFile(specUri));
  await runAnalyzeText(context, wiring, {
    root,
    specName: vscode.workspace.asRelativePath(specUri),
    rawText,
  });
};

export const runReviewCommand = async (
  context: vscode.ExtensionContext,
  wiring: WorkflowWiring,
  target: 'working-tree' | 'commit',
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const outcome = await runJob(
    context,
    `ImpactGraph: reviewing ${target === 'working-tree' ? 'working tree' : 'current commit'}`,
    { op: 'review', rootDir: root, target },
  );
  const report = validated(outcome, cliReviewOutputSchema, wiring.output);
  if (report === undefined) {
    return;
  }
  wiring.reviewTree.setReport(root, report);
  const message = report.discrepanciesFound
    ? 'ImpactGraph: review found discrepancies — inputs to your judgment, not defects (§43.6).'
    : 'ImpactGraph: review found no discrepancies.';
  const action = await vscode.window.showInformationMessage(message, 'Open Review Report');
  if (action === 'Open Review Report') {
    await vscode.commands.executeCommand('impactgraph.openReviewReport');
  }
};

export const runOpenReviewReport = async (wiring: WorkflowWiring): Promise<void> => {
  const report = wiring.reviewTree.current;
  if (report === undefined) {
    void vscode.window.showInformationMessage(
      'ImpactGraph: no review yet — run "Review Working Tree" or "Review Current Commit" first.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildReviewMarkdown(report).join('\n'),
  });
  await vscode.window.showTextDocument(document, { preview: false });
};

export const runExportContext = async (
  context: vscode.ExtensionContext,
  wiring: WorkflowWiring,
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const outcome = await runJob(context, 'ImpactGraph: exporting implementation context', {
    op: 'export',
    rootDir: root,
  });
  const doc = validated(outcome, cliExportOutputSchema, wiring.output);
  if (doc === undefined) {
    return;
  }
  const json = JSON.stringify(doc.context, null, 2);
  const opened = await vscode.workspace.openTextDocument({ language: 'json', content: json });
  await vscode.window.showTextDocument(opened, { preview: false });
  const action = await vscode.window.showInformationMessage(
    'ImpactGraph: §22 implementation context exported (approved analysis only).',
    'Copy to Clipboard',
  );
  if (action === 'Copy to Clipboard') {
    await vscode.env.clipboard.writeText(json);
  }
};
