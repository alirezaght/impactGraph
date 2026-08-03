import { performance } from 'node:perf_hooks';

import * as vscode from 'vscode';

// Shared helpers for the integration suites. Everything here asserts on ids, files and engine
// state — never on notification text, which is locale-fragile (PRD §37, testing-strategy §1.6).

export const EXTENSION_ID = 'impactgraph.impactgraph';

export const requireExtension = (): vscode.Extension<unknown> => {
  const found = vscode.extensions.getExtension(EXTENSION_ID);
  if (found === undefined) {
    throw new Error(`extension '${EXTENSION_ID}' is not loaded in the test instance`);
  }
  return found;
};

export const workspaceRoot = (): string => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    throw new Error('the test instance opened no workspace folder');
  }
  return folder.uri.fsPath;
};

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate` holds; the description ends up in the timeout message. */
export const waitFor = async (
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> => {
  const deadline = performance.now() + timeoutMs;
  let lastError: string | undefined;
  while (performance.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error.message : JSON.stringify(error);
    }
    await delay(150);
  }
  const detail = lastError === undefined ? '' : ` (last error: ${lastError})`;
  throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${description}${detail}`);
};

/**
 * Several §19 commands end by AWAITING a notification with an action button
 * (`showInformationMessage(msg, 'Reindex Now')`). Headless, nobody dismisses it, so awaiting the
 * command would hang forever. Fire it, wait on observable state, then clear notifications.
 */
export const fireCommand = (command: string, ...args: readonly unknown[]): void => {
  void Promise.resolve(vscode.commands.executeCommand(command, ...args)).then(
    () => undefined,
    () => undefined,
  );
};

export const dismissNotifications = async (): Promise<void> => {
  await vscode.commands.executeCommand('notifications.clearAll');
};

export interface ActivationRecord {
  /** undefined when the extension was already active — the budget is then unmeasurable. */
  readonly elapsedMs: number | undefined;
  /** Commands that appeared in the registry as a result of activate() — manifest drift check. */
  readonly registeredOnActivation: readonly string[];
}

let activation: ActivationRecord | undefined;

/**
 * Activates once and records what activation actually did. The before/after command diff is what
 * makes the manifest↔registration check meaningful: `contributes.commands` entries can be known
 * to the registry ahead of activation, but only `registerCommand` adds them during it.
 */
export const activateExtension = async (): Promise<ActivationRecord> => {
  if (activation !== undefined) {
    return activation;
  }
  const extension = requireExtension();
  const before = new Set(await vscode.commands.getCommands(true));
  const alreadyActive = extension.isActive;
  const started = performance.now();
  await extension.activate();
  const elapsed = performance.now() - started;
  const after = await vscode.commands.getCommands(true);
  activation = {
    elapsedMs: alreadyActive ? undefined : elapsed,
    registeredOnActivation: after.filter((id) => !before.has(id)),
  };
  return activation;
};
